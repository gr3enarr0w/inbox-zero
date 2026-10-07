import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { createScopedLogger } from "@/utils/logger";
import { saveParsedEmailMessages } from "@/utils/actions/stats-messages";
import { hydrateImportedSenders } from "@/utils/categorize/senders/hydrate";
import type { SmarterMailStatsFolderState } from "@/generated/prisma/client";
import { smarterMailMessageId } from "./message";
import { SmarterMailMessageNotFoundError } from "./errors";
import { SmarterMailStatsMetadataInconclusiveError } from "./provider/stats-metadata";
import { refreshSmarterMailCachedMetadata } from "./stats-prune";
import { importSmarterMailNewUids } from "./stats-uid-work";
import { importSmarterMailFolderMetadata } from "./stats-folder-import";
import { refreshSmarterMailUidIndex } from "./stats-uid-index";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/prisma");
vi.mock("@/utils/actions/stats-messages", () => ({
  saveParsedEmailMessages: vi.fn(),
}));
vi.mock("@/utils/categorize/senders/hydrate", () => ({
  hydrateImportedSenders: vi.fn(),
}));
vi.mock("./local-sync-context", () => ({
  withSmarterMailLocalSyncContext: (
    _id: string,
    _priority: string,
    operation: () => Promise<unknown>,
  ) => operation(),
}));
const logger = createScopedLogger("stats-metadata-test");
const folder = {
  emailAccountId: "account",
  folderId: "Inbox",
  folderGuid: "guid",
  generation: "metadata",
  uidGeneration: "uids",
  uidScanComplete: true,
  uidNextRefreshAt: new Date(Date.now() + 300_000),
  baselineComplete: true,
  cursor: "40",
  uidCursor: "persisted",
  after: new Date("2026-07-01"),
  before: new Date("2026-10-01"),
  recentComplete: false,
  mode: "recent",
  refreshAfter: new Date("2026-10-02"),
} as SmarterMailStatsFolderState;
const message = {
  id: smarterMailMessageId("Inbox", 1),
  threadId: smarterMailMessageId("Inbox", 1),
  internalDate: String(folder.after!.getTime()),
  subject: "Test",
  headers: { from: "sender@example.com" },
  labelIds: ["INBOX"],
} as never;
const getStatsMessage = vi.fn();
const getStatsMessages = vi.fn();
const getStatsMessagesWithPagination = vi.fn();
const getStatsFolderUids = vi.fn();
const provider = {
  getStatsMessage,
  getStatsMessages,
  getStatsMessagesWithPagination,
  getStatsFolderUids,
};

describe("bounded incremental metadata and retained history", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prisma.smarterMailStatsUid.findMany.mockResolvedValue([]);
    prisma.emailMessage.findMany.mockResolvedValue([]);
    prisma.smarterMailStatsFolderState.updateMany.mockResolvedValue({
      count: 1,
    });
    prisma.$executeRaw.mockResolvedValue(1);
    vi.mocked(saveParsedEmailMessages).mockResolvedValue(1);
    vi.mocked(hydrateImportedSenders).mockResolvedValue({ created: 0 });
    getStatsMessage.mockResolvedValue(message);
    getStatsMessages.mockResolvedValue([message]);
  });
  it("refreshes cached flags with one metadata batch and no body reads", async () => {
    prisma.emailMessage.findMany.mockResolvedValue([
      { messageId: message.id, providerUid: 1n },
    ] as never);
    await refreshSmarterMailCachedMetadata(folder, provider, "lease", logger);
    expect(getStatsMessages).toHaveBeenCalledExactlyOnceWith([message.id]);
    expect(getStatsMessage).not.toHaveBeenCalled();
    expect(saveParsedEmailMessages).toHaveBeenCalledWith(
      "account",
      [message],
      logger,
      expect.objectContaining({
        folderGuid: "guid",
        generation: "metadata",
        leaseToken: "lease",
      }),
    );
    expect(prisma.emailMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { lastCheckedAt: null },
            { lastCheckedAt: { lte: folder.refreshAfter } },
          ],
        }),
      }),
    );
  });
  it("retains exact native absence instead of deleting history", async () => {
    prisma.smarterMailStatsUid.findMany.mockResolvedValue([
      { uid: 1n },
    ] as never);
    getStatsMessage.mockRejectedValue(new SmarterMailMessageNotFoundError());
    await refreshSmarterMailCachedMetadata(folder, provider, "lease", logger);
    expect(prisma.$executeRaw).toHaveBeenCalledOnce();
    const raw = prisma.$executeRaw.mock.calls[0][0] as unknown as
      | string[]
      | { strings: string[] };
    const sql = Array.isArray(raw) ? raw : raw.strings;
    expect(sql.join("")).toContain('SET "removedAt" = NOW()');
    expect(sql.join("")).not.toContain("DELETE");
    expect(sql.join("")).toContain("FOR UPDATE");
    expect(saveParsedEmailMessages).not.toHaveBeenCalled();
  });
  it("retains all cached rows when missing-inventory confirmation is transient", async () => {
    prisma.smarterMailStatsUid.findMany.mockResolvedValue([
      { uid: 1n },
    ] as never);
    getStatsMessage.mockRejectedValue(new Error("Unavailable"));
    await expect(
      refreshSmarterMailCachedMetadata(folder, provider, "lease", logger),
    ).rejects.toThrow("Unavailable");
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
  it("does not mark missing metadata as absence without native proof", async () => {
    prisma.smarterMailStatsUid.findMany.mockResolvedValue([
      { uid: 1n },
    ] as never);
    getStatsMessages.mockRejectedValue(
      new SmarterMailStatsMetadataInconclusiveError(),
    );
    prisma.smarterMailStatsUid.findMany.mockResolvedValueOnce([
      { uid: 1n },
    ] as never);
    getStatsMessage.mockRejectedValue(new Error("Unavailable"));
    await expect(
      importSmarterMailNewUids(folder, provider, "lease", logger),
    ).rejects.toThrow("Unavailable");
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
  it("imports an old-date UID discovered by the lightweight index without a date gate", async () => {
    prisma.smarterMailStatsUid.findMany.mockResolvedValue([
      { uid: 1n },
    ] as never);
    expect(
      await importSmarterMailNewUids(folder, provider, "lease", logger),
    ).toBe(1);
    expect(getStatsMessages).toHaveBeenCalledWith([message.id]);
    expect(getStatsMessage).not.toHaveBeenCalled();
    expect(hydrateImportedSenders).toHaveBeenCalled();
  });
  it("reuses imported native copies when replaying UID inventory", async () => {
    prisma.smarterMailStatsUid.findMany.mockResolvedValue([
      { uid: 1n },
    ] as never);
    prisma.emailMessage.findMany.mockResolvedValue([
      { providerUid: 1n },
    ] as never);
    expect(
      await importSmarterMailNewUids(folder, provider, "lease", logger),
    ).toBe(0);
    expect(getStatsMessages).not.toHaveBeenCalled();
    expect(saveParsedEmailMessages).not.toHaveBeenCalled();
  });
  it("resumes a folder-local metadata cursor and advances an empty intermediate page", async () => {
    getStatsMessagesWithPagination.mockResolvedValue({
      messages: [],
      nextPageToken: "60",
    });
    await importSmarterMailFolderMetadata({
      folder,
      provider,
      leaseToken: "lease",
      logger,
    });
    expect(getStatsMessagesWithPagination).toHaveBeenCalledWith({
      folderId: "Inbox",
      pageToken: "40",
      maxResults: 20,
      after: folder.after,
      before: folder.before,
    });
    expect(prisma.smarterMailStatsFolderState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          folderId: "Inbox",
          generation: "metadata",
        }),
        data: expect.objectContaining({ cursor: "60", recentComplete: false }),
      }),
    );
  });
  it("does not advance a folder checkpoint when sender hydration fails", async () => {
    getStatsMessagesWithPagination.mockResolvedValue({
      messages: [message],
      nextPageToken: "60",
    });
    vi.mocked(hydrateImportedSenders).mockRejectedValue(
      new Error("Database unavailable"),
    );
    await expect(
      importSmarterMailFolderMetadata({
        folder,
        provider,
        leaseToken: "lease",
        logger,
      }),
    ).rejects.toThrow("Database unavailable");
    expect(
      prisma.smarterMailStatsFolderState.updateMany,
    ).not.toHaveBeenCalled();
  });
  it("resumes UID membership after client recreation and checkpoints one folder only", async () => {
    getStatsFolderUids.mockResolvedValue({ uids: [1], total: 1 });
    await refreshSmarterMailUidIndex(
      { ...folder, uidScanComplete: false },
      provider,
      "lease",
    );
    expect(getStatsFolderUids).toHaveBeenCalledWith({
      folderId: "Inbox",
      pageToken: "persisted",
      maxResults: 1000,
    });
    expect(prisma.smarterMailStatsFolderState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          folderId: "Inbox",
          emailAccountId: "account",
        }),
        data: expect.objectContaining({
          baselineComplete: true,
          uidScanComplete: true,
          uidCursor: null,
        }),
      }),
    );
    const raw = prisma.$executeRaw.mock.calls[0][0] as unknown as
      | string[]
      | { strings: string[] };
    const sql = Array.isArray(raw) ? raw : raw.strings;
    expect(sql.join("")).toContain("NOT EXISTS");
    expect(sql.join("")).toContain('"providerUid"');
  });
});
