import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { createScopedLogger } from "@/utils/logger";
import { saveParsedEmailMessages } from "@/utils/actions/stats-messages";
import { hydrateImportedSenders } from "@/utils/categorize/senders/hydrate";
import { InvalidMailboxSyncCursorError } from "@/utils/email/mailbox-sync";
import type { EmailProvider } from "@/utils/email/types";
import type { ParsedMessage } from "@/utils/types";
import { reconcileSmarterMailStats } from "./stats-prune";
import { loadSmarterMailStats } from "./stats-import";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/prisma");
vi.mock("@/utils/smartermail/stats-prune", () => ({
  reconcileSmarterMailStats: vi.fn(),
}));
vi.mock("@/utils/actions/stats-messages", () => ({
  saveParsedEmailMessages: vi.fn(),
}));
vi.mock("@/utils/categorize/senders/hydrate", () => ({
  hydrateImportedSenders: vi.fn(),
}));
vi.mock("@/utils/smartermail/local-sync-context", () => ({
  withSmarterMailLocalSyncContext: (
    _id: string,
    _priority: string,
    operation: () => Promise<unknown>,
  ) => operation(),
}));
const logger = createScopedLogger("stats-import-test");
const search = vi.fn();
const emailProvider = {
  name: "smartermail",
  searchMessages: search,
} as unknown as EmailProvider;
const after = new Date("2026-07-01T00:00:00Z");
const before = new Date("2026-10-01T00:00:00Z");
const message = {
  id: "sm:Inbox:1",
  threadId: "sm:Inbox:1",
  internalDate: String(after.getTime()),
  date: after.toISOString(),
  labelIds: ["INBOX", "UNREAD"],
  headers: { from: "sender@example.com" },
} as ParsedMessage;
const baseState = {
  emailAccountId: "account",
  generation: "pass-one",
  phase: "scan",
  cursor: "persisted-folder-page",
  after,
  before,
  historyComplete: false,
  completedAt: null,
  totalImported: 10,
  nextRunAt: new Date(0),
  failures: 0,
  importError: null,
};

function load(loadBefore = false) {
  return loadSmarterMailStats({
    emailAccountId: "account",
    emailProvider,
    logger,
    loadBefore,
  });
}

describe("SmarterMail durable statistics import", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
    prisma.smarterMailStatsImportState.upsert.mockResolvedValue(
      baseState as never,
    );
    prisma.smarterMailStatsImportState.findUniqueOrThrow.mockResolvedValue(
      baseState as never,
    );
    prisma.smarterMailStatsImportState.updateMany.mockResolvedValue({
      count: 1,
    });
    prisma.emailMessage.count.mockResolvedValue(11);
    search.mockResolvedValue({
      messages: [message],
      nextPageToken: "next-page",
    });
    vi.mocked(reconcileSmarterMailStats).mockResolvedValue({ complete: true });
    vi.mocked(saveParsedEmailMessages).mockResolvedValue(1);
    vi.mocked(hydrateImportedSenders).mockResolvedValue({ created: 1 });
  });
  afterEach(() => vi.useRealTimers());

  it("resumes the same account-scoped cursor and fixed bounds across requests", async () => {
    expect(await load()).toMatchObject({
      complete: false,
      totalImported: 11,
      hasMoreAfter: true,
    });
    expect(search).toHaveBeenCalledWith({
      query: "",
      maxResults: 20,
      pageToken: baseState.cursor,
      after,
      before,
    });
    expect(
      prisma.smarterMailStatsImportState.updateMany,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          emailAccountId: "account",
          leaseToken: expect.any(String),
          leaseUntil: { gt: expect.any(Date) },
        }),
        data: expect.objectContaining({
          cursor: "next-page",
          completedAt: null,
          totalImported: 11,
        }),
      }),
    );
    expect(saveParsedEmailMessages).toHaveBeenCalledWith(
      "account",
      [message],
      logger,
      { generation: "pass-one", leaseToken: expect.any(String) },
    );
    expect(hydrateImportedSenders).toHaveBeenCalledWith({
      emailAccountId: "account",
      messages: [message],
    });
  });

  it("does not interpret an empty intermediate folder page as completion", async () => {
    search.mockResolvedValue({ messages: [], nextPageToken: "later-folders" });
    vi.mocked(saveParsedEmailMessages).mockResolvedValue(0);
    expect(await load()).toMatchObject({
      pages: 1,
      complete: false,
      hasMoreAfter: true,
    });
    expect(
      prisma.smarterMailStatsImportState.updateMany,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cursor: "later-folders",
          completedAt: null,
        }),
      }),
    );
  });

  it("starts reconciliation after scan exhaustion instead of claiming snapshot completion", async () => {
    search.mockResolvedValue({ messages: [message] });
    expect(await load()).toMatchObject({ complete: false, hasMoreAfter: true });
    expect(
      prisma.smarterMailStatsImportState.updateMany,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phase: "prune",
          cursor: null,
          completedAt: null,
        }),
      }),
    );
  });

  it("completes after bounded verified reconciliation drains its durable worklist", async () => {
    prisma.smarterMailStatsImportState.findUniqueOrThrow.mockResolvedValue({
      ...baseState,
      phase: "prune",
    } as never);
    expect(await load()).toMatchObject({ complete: true, hasMoreAfter: false });
    expect(reconcileSmarterMailStats).toHaveBeenCalledWith(
      expect.objectContaining({
        generation: "pass-one",
        after,
        before,
        emailAccountId: "account",
      }),
    );
    expect(search).not.toHaveBeenCalled();
  });

  it("initializes the recent90day window independent of imported message date order", async () => {
    await load();
    expect(prisma.smarterMailStatsImportState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          emailAccountId: "account",
          after: new Date(Date.now() - 90 * 86_400_000),
          before: new Date(),
        },
      }),
    );
    expect(prisma.emailMessage.findFirst).not.toHaveBeenCalled();
  });

  it("does not read when a second worker already owns the account lease", async () => {
    prisma.smarterMailStatsImportState.updateMany.mockResolvedValueOnce({
      count: 0,
    });
    expect(await load()).toMatchObject({ complete: false, totalImported: 10 });
    expect(search).not.toHaveBeenCalled();
  });

  it.each([
    "save",
    "sender",
  ])("keeps the durable cursor when %s persistence fails", async (stage) => {
    if (stage === "save")
      vi.mocked(saveParsedEmailMessages).mockRejectedValue(
        new Error("Database unavailable"),
      );
    else
      vi.mocked(hydrateImportedSenders).mockRejectedValue(
        new Error("Database unavailable"),
      );
    await expect(load()).rejects.toThrow("Database unavailable");
    expect(
      prisma.smarterMailStatsImportState.updateMany,
    ).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cursor: "next-page" }),
      }),
    );
    expect(
      prisma.smarterMailStatsImportState.updateMany,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          importError: expect.any(String),
          leaseToken: null,
        }),
      }),
    );
  });

  it("does not restart a completed pass during the preload cooldown", async () => {
    prisma.smarterMailStatsImportState.findUniqueOrThrow.mockResolvedValue({
      ...baseState,
      completedAt: new Date(),
    } as never);
    expect(await load()).toMatchObject({ complete: true });
    expect(search).not.toHaveBeenCalled();
  });

  it("extends history from the persisted window boundary, never oldest imported date", async () => {
    prisma.smarterMailStatsImportState.findUniqueOrThrow
      .mockResolvedValueOnce({ ...baseState, completedAt: new Date() } as never)
      .mockResolvedValueOnce({
        ...baseState,
        cursor: null,
        generation: "older-pass",
        after: null,
        before: after,
      } as never);
    await load(true);
    expect(search).toHaveBeenCalledWith({
      query: "",
      maxResults: 20,
      pageToken: undefined,
      after: undefined,
      before: after,
    });
    expect(prisma.emailMessage.findFirst).not.toHaveBeenCalled();
  });

  it("reports requested older history as pending after a recent pass completes", async () => {
    prisma.smarterMailStatsImportState.findUniqueOrThrow.mockResolvedValue({
      ...baseState,
      phase: "prune",
    } as never);
    expect(await load(true)).toMatchObject({
      complete: false,
      hasMoreBefore: true,
    });
  });

  it("rejects malformed dates without advancing the import cursor", async () => {
    search.mockResolvedValue({
      messages: [{ ...message, internalDate: undefined }],
    });
    await expect(load()).rejects.toThrow("valid date");
    expect(saveParsedEmailMessages).not.toHaveBeenCalled();
  });

  it("resets an invalidated inventory cursor without claiming completion", async () => {
    search.mockRejectedValue(new InvalidMailboxSyncCursorError());
    await expect(load()).rejects.toThrow("Invalid mailbox sync cursor");
    expect(prisma.smarterMailStatsImportState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { cursor: null } }),
    );
    expect(saveParsedEmailMessages).not.toHaveBeenCalled();
  });

  it("reports incomplete if a resumed worker lost its lease before checkpointing", async () => {
    search.mockResolvedValue({ messages: [] });
    prisma.smarterMailStatsImportState.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    expect(await load()).toMatchObject({ complete: false, hasMoreAfter: true });
  });
});
