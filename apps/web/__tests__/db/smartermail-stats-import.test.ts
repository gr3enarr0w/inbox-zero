import { Client } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/prisma";
import { getMockMessage, createTestLogger } from "@/__tests__/helpers";
import { saveParsedEmailMessages } from "@/utils/actions/stats-messages";
import { reconcileSmarterMailStats } from "@/utils/smartermail/stats-prune";
import { SmarterMailMessageNotFoundError } from "@/utils/smartermail/errors";
import type { EmailProvider } from "@/utils/email/types";

vi.mock("server-only", () => ({}));
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
    id: "copy-one",
    threadId: "copy-one",
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
      const second = { ...message, id: "copy-two", threadId: "copy-two" };
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
        messageId: "copy-one",
        smarterMailStatsGeneration: generation,
        inbox: false,
      });
      expect(rows[1].messageId).toBe("copy-two");
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

    it("removes verified stale references only inside the pass window", async () => {
      await saveParsedEmailMessages(
        emailAccountId,
        [
          message,
          {
            ...message,
            id: "older-history",
            threadId: "older-history",
            internalDate: String(new Date("2026-01-01").getTime()),
          },
        ],
        logger,
      );
      const getMessage = vi
        .fn()
        .mockRejectedValue(new SmarterMailMessageNotFoundError());
      expect(
        await reconcileSmarterMailStats({
          emailAccountId,
          generation,
          leaseToken,
          after,
          before,
          emailProvider: { getMessage } as unknown as EmailProvider,
          logger,
        }),
      ).toEqual({ complete: true });
      const rows = await prisma.emailMessage.findMany({
        where: { emailAccountId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].messageId).toBe("older-history");
      expect(getMessage).toHaveBeenCalledExactlyOnceWith("copy-one");
    });
  },
);
