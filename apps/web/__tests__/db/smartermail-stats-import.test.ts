import { Client } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/prisma";
import { getMockMessage, createTestLogger } from "@/__tests__/helpers";
import { saveParsedEmailMessages } from "@/utils/actions/stats-messages";
import { refreshSmarterMailUidIndex } from "@/utils/smartermail/stats-uid-index";
import {
  retainSmarterMailAbsentMetadata,
  retainSmarterMailFolderMetadata,
} from "@/utils/smartermail/stats-uid-work";
import { smarterMailMessageId } from "@/utils/smartermail/message";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/smartermail/local-sync-context", () => ({
  withSmarterMailLocalSyncContext: (
    _id: string,
    _priority: string,
    operation: () => Promise<unknown>,
  ) => operation(),
}));
vi.mock("@/env", () => ({
  env: {
    DATABASE_URL:
      process.env.STATS_TEST_DATABASE_URL ?? process.env.DATABASE_URL,
    NODE_ENV: "test",
  },
}));
const logger = createTestLogger();
const owner = "smartermail-stats-db-test@example.com";
const generation = "db-test-generation";
const leaseToken = "db-test-old-owner";
let emailAccountId: string;
const after = new Date("2026-07-01T00:00:00Z");
const before = new Date("2026-10-01T00:00:00Z");
const message = {
  ...getMockMessage({
    id: smarterMailMessageId("Inbox", 1),
    threadId: smarterMailMessageId("Inbox", 1),
    labelIds: ["INBOX"],
  }),
  internalDate: String(after.getTime()),
};

describe.skipIf(!process.env.RUN_DB_TESTS)(
  "SmarterMail statistics SQL lease fencing",
  { timeout: 20_000 },
  () => {
    beforeEach(async () => {
      await prisma.user.deleteMany({ where: { email: owner } });
      const user = await prisma.user.create({ data: { email: owner } });
      const account = await prisma.account.create({
        data: {
          provider: "smartermail",
          providerAccountId: owner,
          type: "credentials",
          userId: user.id,
        },
      });
      const mailbox = await prisma.emailAccount.create({
        data: { email: owner, userId: user.id, accountId: account.id },
      });
      emailAccountId = mailbox.id;
      await prisma.smarterMailStatsImportState.create({
        data: {
          emailAccountId,
          after,
          before,
          generation,
          leaseToken,
          leaseUntil: new Date(Date.now() + 60_000),
        },
      });
    });
    afterAll(async () => {
      await prisma.user.deleteMany({ where: { email: owner } });
      await prisma.$disconnect();
    });

    it("retains distinct native copies and updates the same native row idempotently", async () => {
      const second = {
        ...message,
        id: smarterMailMessageId("Inbox", 2),
        threadId: smarterMailMessageId("Inbox", 2),
      };
      expect(
        await saveParsedEmailMessages(
          emailAccountId,
          [message, second],
          logger,
          { generation, leaseToken },
        ),
      ).toBe(2);
      await saveParsedEmailMessages(
        emailAccountId,
        [{ ...message, labelIds: [] }],
        logger,
        { generation, leaseToken },
      );
      const rows = await prisma.emailMessage.findMany({
        where: { emailAccountId },
        orderBy: { messageId: "asc" },
      });
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        messageId: message.id,
        smarterMailStatsGeneration: generation,
        inbox: false,
      });
      expect(rows[1].messageId).toBe(second.id);
    });

    it("rejects an old writer waiting behind a lease transfer without modifying cache rows", async () => {
      const locker = new Client({
        connectionString:
          process.env.STATS_TEST_DATABASE_URL ?? process.env.DATABASE_URL,
      });
      await locker.connect();
      let pending: Promise<{ error?: unknown }> | undefined;
      try {
        await locker.query("BEGIN");
        await locker.query(
          'SELECT * FROM "SmarterMailStatsImportState" WHERE "emailAccountId" = $1 FOR UPDATE',
          [emailAccountId],
        );
        pending = saveParsedEmailMessages(emailAccountId, [message], logger, {
          generation,
          leaseToken,
        }).then(
          () => ({}),
          (error) => ({ error }),
        );
        const deadline = Date.now() + 3000;
        let blocked = false;
        while (Date.now() < deadline) {
          const waiting = await locker.query(
            "SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%WITH owned_state%' AND pid <> pg_backend_pid()",
          );
          if (waiting.rowCount) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(blocked).toBe(true);
        await locker.query(
          'UPDATE "SmarterMailStatsImportState" SET "leaseToken" = $1 WHERE "emailAccountId" = $2',
          ["db-test-new-owner", emailAccountId],
        );
        await locker.query("COMMIT");
        expect((await pending).error).toBeInstanceOf(Error);
        expect(
          await prisma.emailMessage.count({ where: { emailAccountId } }),
        ).toBe(0);
      } finally {
        await locker.query("ROLLBACK");
        await pending;
        await locker.end();
      }
    });

    it("retains removed native records and their full metadata", async () => {
      const folder = await prisma.smarterMailStatsFolderState.create({
        data: {
          emailAccountId,
          folderId: "Inbox",
          folderGuid: "guid",
          generation,
          before,
          historyBefore: after,
        },
      });
      await prisma.smarterMailStatsUid.create({
        data: {
          emailAccountId,
          folderId: "Inbox",
          uid: 1n,
          generation,
          needsImport: true,
        },
      });
      await saveParsedEmailMessages(emailAccountId, [message], logger, {
        generation,
        leaseToken,
        folderId: "Inbox",
        folderGuid: "guid",
      });
      await retainSmarterMailAbsentMetadata(folder, 1n, leaseToken);
      const rows = await prisma.emailMessage.findMany({
        where: { emailAccountId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        messageId: message.id,
        subject: message.subject,
      });
      expect(rows[0].removedAt).toBeInstanceOf(Date);
      expect(
        await prisma.smarterMailStatsUid.findUnique({
          where: {
            emailAccountId_folderId_uid: {
              emailAccountId,
              folderId: "Inbox",
              uid: 1n,
            },
          },
        }),
      ).toMatchObject({ needsImport: false, removedAt: expect.any(Date) });
    });
    it("preserves a recycled UID version and optional header metadata without duplicating flags", async () => {
      await prisma.smarterMailStatsFolderState.create({
        data: {
          emailAccountId,
          folderId: "Inbox",
          folderGuid: "guid",
          generation,
          before,
          historyBefore: after,
        },
      });
      const options = {
        generation,
        leaseToken,
        folderId: "Inbox",
        folderGuid: "guid",
      };
      const rich = {
        ...message,
        headers: {
          ...message.headers,
          "message-id": "<original@example.com>",
          "list-unsubscribe": "<mailto:unsubscribe@example.com>",
        },
      };
      await saveParsedEmailMessages(emailAccountId, [rich], logger, options);
      await saveParsedEmailMessages(
        emailAccountId,
        [{ ...message, labelIds: [] }],
        logger,
        options,
      );
      const existing = await prisma.emailMessage.findMany({
        where: { emailAccountId },
      });
      expect(existing).toHaveLength(1);
      expect(existing[0]).toMatchObject({
        rfcMessageId: "<original@example.com>",
        unsubscribeLink: "<mailto:unsubscribe@example.com>",
        inbox: false,
      });
      await saveParsedEmailMessages(
        emailAccountId,
        [{ ...message, subject: "Different native UID incarnation" }],
        logger,
        options,
      );
      const versions = await prisma.emailMessage.findMany({
        where: { emailAccountId },
        orderBy: { createdAt: "asc" },
      });
      expect(versions).toHaveLength(2);
      expect(versions.filter((row) => row.removedAt === null)).toHaveLength(1);
      expect(
        versions.find((row) => row.subject === message.subject)?.removedAt,
      ).toBeInstanceOf(Date);
      expect(versions.every((row) => row.messageId === message.id)).toBe(true);
    });
    it("persists folder UID membership and queues uncached arrivals during the initial baseline", async () => {
      const folder = await prisma.smarterMailStatsFolderState.create({
        data: {
          emailAccountId,
          folderId: "Inbox",
          folderGuid: "guid",
          generation,
          uidGeneration: "uid-baseline",
          uidCursor: "saved-page",
          before,
          historyBefore: after,
        },
      });
      await saveParsedEmailMessages(emailAccountId, [message], logger, {
        generation,
        leaseToken,
        folderId: "Inbox",
        folderGuid: "guid",
      });
      const getStatsFolderUids = vi
        .fn()
        .mockResolvedValueOnce({
          uids: [1, 2],
          total: 3,
          nextPageToken: "arrival-page",
        })
        .mockResolvedValueOnce({ uids: [3], total: 3 });
      await refreshSmarterMailUidIndex(
        folder,
        { getStatsFolderUids },
        leaseToken,
      );
      expect(
        getStatsFolderUids.mock.calls.map(([input]) => input.pageToken),
      ).toEqual(["saved-page", "arrival-page"]);
      const rows = await prisma.smarterMailStatsUid.findMany({
        where: { emailAccountId },
        orderBy: { uid: "asc" },
      });
      expect(rows.map((row) => [row.uid, row.needsImport])).toEqual([
        [1n, false],
        [2n, true],
        [3n, true],
      ]);
      expect(
        await prisma.smarterMailStatsFolderState.findUnique({
          where: {
            emailAccountId_folderId: { emailAccountId, folderId: "Inbox" },
          },
        }),
      ).toMatchObject({
        baselineComplete: true,
        uidScanComplete: true,
        uidCursor: null,
      });
      await retainSmarterMailFolderMetadata(folder, leaseToken);
      expect(
        await prisma.emailMessage.count({
          where: { emailAccountId, removedAt: null },
        }),
      ).toBe(0);
      expect(
        await prisma.emailMessage.count({
          where: { emailAccountId, removedAt: { not: null } },
        }),
      ).toBe(1);
      expect(
        await prisma.smarterMailStatsUid.count({
          where: { emailAccountId, removedAt: { not: null } },
        }),
      ).toBe(3);
    });
  },
);
