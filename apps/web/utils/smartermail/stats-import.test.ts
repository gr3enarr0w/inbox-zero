import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { createScopedLogger } from "@/utils/logger";
import type { EmailProvider } from "@/utils/email/types";
import { refreshSmarterMailUidIndex } from "./stats-uid-index";
import { importSmarterMailFolderMetadata } from "./stats-folder-import";
import {
  importSmarterMailNewUids,
  retainSmarterMailFolderMetadata,
} from "./stats-uid-work";
import { refreshSmarterMailCachedMetadata } from "./stats-prune";
import { loadSmarterMailStats } from "./stats-import";
import { getSmarterMailLocalSyncContext } from "./local-sync-context";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/prisma");
vi.mock("./stats-uid-index", () => ({ refreshSmarterMailUidIndex: vi.fn() }));
vi.mock("./stats-folder-import", () => ({
  importSmarterMailFolderMetadata: vi.fn(),
}));
vi.mock("./stats-uid-work", () => ({
  importSmarterMailNewUids: vi.fn(),
  retainSmarterMailFolderMetadata: vi.fn(),
}));
vi.mock("./stats-prune", () => ({ refreshSmarterMailCachedMetadata: vi.fn() }));
vi.mock("./local-sync-context", () => ({
  getSmarterMailLocalSyncContext: vi.fn(),
  withSmarterMailLocalSyncContext: (
    _id: string,
    _priority: string,
    operation: () => Promise<unknown>,
  ) => operation(),
}));
const after = new Date("2026-07-01");
const before = new Date("2026-10-01");
const state = {
  emailAccountId: "account",
  totalImported: 10,
  after,
  before,
  failures: 0,
  historyRequested: false,
  importError: null,
  nextRunAt: new Date(0),
};
const folder = {
  emailAccountId: "account",
  folderId: "Inbox",
  folderGuid: "guid",
  generation: "page",
  uidGeneration: "uids",
  cursor: "40",
  after,
  before,
  historyBefore: after,
  recentComplete: false,
  historyComplete: false,
  uidScanComplete: true,
  refreshAfter: null,
  mode: "recent",
};
const getStatsFolders = vi.fn();
const provider = {
  name: "smartermail",
  getStatsFolders,
} as unknown as EmailProvider;
const logger = createScopedLogger("stats-import-test");
const load = () =>
  loadSmarterMailStats({
    emailAccountId: "account",
    emailProvider: provider,
    logger,
    loadBefore: false,
  });

describe("per-folder durable statistics coordinator", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prisma.smarterMailStatsImportState.upsert.mockResolvedValue(state as never);
    prisma.smarterMailStatsImportState.findUniqueOrThrow.mockResolvedValue(
      state as never,
    );
    prisma.smarterMailStatsImportState.updateMany.mockResolvedValue({
      count: 1,
    });
    prisma.smarterMailStatsFolderState.upsert.mockResolvedValue(
      folder as never,
    );
    prisma.smarterMailStatsFolderState.findMany.mockResolvedValue([]);
    prisma.smarterMailStatsFolderState.findFirst.mockResolvedValue(
      folder as never,
    );
    prisma.smarterMailStatsFolderState.findUniqueOrThrow.mockResolvedValue(
      folder as never,
    );
    prisma.smarterMailStatsFolderState.updateMany.mockResolvedValue({
      count: 1,
    });
    prisma.smarterMailStatsFolderState.count.mockResolvedValue(1);
    prisma.smarterMailStatsUid.count.mockResolvedValue(0);
    prisma.emailMessage.count.mockResolvedValue(0);
    prisma.emailMessage.aggregate.mockResolvedValue({
      _count: { _all: 10 },
      _max: { lastCheckedAt: null },
    } as never);
    prisma.smarterMailStatsUid.aggregate.mockResolvedValue({
      _count: { _all: 100 },
      _max: { lastCheckedAt: null },
    } as never);
    getStatsFolders.mockResolvedValue([{ id: "Inbox", guid: "guid" }]);
    vi.mocked(importSmarterMailFolderMetadata).mockResolvedValue(1);
    vi.mocked(importSmarterMailNewUids).mockResolvedValue(1);
  });
  it("resumes the saved folder cursor without an inventory-wide reset", async () => {
    getStatsFolders.mockResolvedValue([
      { id: "Inbox", guid: "guid" },
      { id: "Sent", guid: "sent" },
    ]);
    prisma.smarterMailStatsFolderState.upsert
      .mockResolvedValueOnce(folder as never)
      .mockResolvedValueOnce({
        ...folder,
        folderId: "Sent",
        folderGuid: "sent",
      } as never);
    const result = await load();
    expect(result).toMatchObject({ complete: false, pages: 1 });
    expect(importSmarterMailFolderMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: expect.objectContaining({ cursor: "40", after, before }),
      }),
    );
    expect(
      prisma.smarterMailStatsFolderState.updateMany,
    ).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cursor: null }),
      }),
    );
  });
  it("never repeats a completed history import during incremental UID/flag refresh", async () => {
    prisma.smarterMailStatsFolderState.findUniqueOrThrow.mockResolvedValue({
      ...folder,
      recentComplete: true,
      historyComplete: true,
    } as never);
    prisma.smarterMailStatsFolderState.count.mockResolvedValue(0);
    expect(await load()).toMatchObject({ complete: true });
    expect(importSmarterMailFolderMetadata).not.toHaveBeenCalled();
    expect(refreshSmarterMailUidIndex).toHaveBeenCalled();
    expect(refreshSmarterMailCachedMetadata).toHaveBeenCalled();
  });
  it("reports one committed work page even when the metadata page is empty", async () => {
    vi.mocked(importSmarterMailFolderMetadata).mockResolvedValue(0);
    vi.mocked(importSmarterMailNewUids).mockResolvedValue(0);
    expect(await load()).toMatchObject({
      pages: 1,
      complete: false,
      loadedAfterMessages: 0,
    });
  });
  it("does no provider reads under another worker lease", async () => {
    prisma.smarterMailStatsImportState.updateMany.mockResolvedValueOnce({
      count: 0,
    });
    expect(await load()).toMatchObject({ pages: 0, complete: false });
    expect(getStatsFolders).not.toHaveBeenCalled();
  });
  it("retains a vanished folder without treating excluded spam as vanished", async () => {
    getStatsFolders.mockResolvedValue([
      { id: "Inbox", guid: "guid" },
      { id: "Spam", guid: "spam" },
    ]);
    prisma.smarterMailStatsFolderState.findMany.mockResolvedValue([
      { ...folder, folderId: "Old" },
    ] as never);
    await load();
    expect(prisma.smarterMailStatsFolderState.findMany).toHaveBeenCalledWith({
      where: {
        emailAccountId: "account",
        folderId: { notIn: ["Inbox", "Spam"] },
      },
    });
    expect(retainSmarterMailFolderMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: "Old" }),
      expect.any(String),
    );
  });
  it("retains all old incarnation metadata before resetting a recreated folder", async () => {
    getStatsFolders.mockResolvedValue([{ id: "Inbox", guid: "new-guid" }]);
    await load();
    expect(retainSmarterMailFolderMetadata).toHaveBeenCalledWith(
      folder,
      expect.any(String),
    );
    expect(prisma.smarterMailStatsFolderState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          folderGuid: "new-guid",
          after,
          before,
          cursor: null,
          baselineComplete: false,
        }),
      }),
    );
  });
  it("continues mutable metadata backlog promptly with a fixed refresh boundary", async () => {
    prisma.emailMessage.count
      .mockResolvedValueOnce(50)
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(3);
    const result = await load();
    expect(result).toMatchObject({ totalImported: 100, totalRetained: 3 });
    expect(prisma.smarterMailStatsFolderState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nextRefreshAt: expect.any(Date),
          refreshAfter: expect.any(Date),
        }),
      }),
    );
    const scheduled = prisma.smarterMailStatsFolderState.updateMany.mock
      .calls[0][0].data.nextRefreshAt as Date;
    expect(scheduled.getTime()).toBeLessThan(Date.now() + 1000);
    expect(prisma.smarterMailStatsFolderState.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { nextRefreshAt: { lte: expect.any(Date) } },
          ]),
        }),
      }),
    );
  });
  it("finishes recent and historical metadata when the complete UID worklist drains", async () => {
    prisma.smarterMailStatsFolderState.findUniqueOrThrow.mockResolvedValue({
      ...folder,
      baselineComplete: true,
    } as never);
    await load();
    expect(prisma.smarterMailStatsFolderState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recentComplete: true,
          historyComplete: true,
          cursor: null,
          completedAt: expect.any(Date),
        }),
      }),
    );
  });
  it("limits discovery hydration to five bounded metadata batches", async () => {
    prisma.smarterMailStatsUid.count.mockResolvedValue(1000);
    await load();
    expect(importSmarterMailNewUids).toHaveBeenCalledTimes(5);
  });
  it("keeps cursor progress on failure and backs off without claiming completion", async () => {
    vi.mocked(importSmarterMailNewUids).mockRejectedValue(
      new Error("Unavailable"),
    );
    await expect(load()).rejects.toThrow("Unavailable");
    expect(
      prisma.smarterMailStatsImportState.updateMany,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          leaseToken: expect.any(String),
          leaseUntil: { gt: expect.any(Date) },
        }),
        data: expect.objectContaining({
          failures: { increment: 1 },
          importError: expect.any(String),
          nextRunAt: expect.any(Date),
        }),
      }),
    );
  });
  it("returns committed partial progress on its own deadline without failure backoff", async () => {
    const deadline = new AbortController();
    deadline.abort(new DOMException("Deadline", "TimeoutError"));
    vi.mocked(getSmarterMailLocalSyncContext).mockReturnValue({
      emailAccountId: "account",
      priority: "backfill",
      signal: deadline.signal,
    });
    const error = new Error("Request aborted");
    error.name = "AbortError";
    vi.mocked(importSmarterMailNewUids).mockRejectedValue(error);
    prisma.emailMessage.aggregate
      .mockResolvedValueOnce({
        _count: { _all: 10 },
        _max: { lastCheckedAt: null },
      } as never)
      .mockResolvedValueOnce({
        _count: { _all: 61 },
        _max: { lastCheckedAt: new Date() },
      } as never);
    prisma.emailMessage.count
      .mockResolvedValueOnce(61)
      .mockResolvedValueOnce(2);
    expect(await load()).toMatchObject({
      totalImported: 61,
      totalRetained: 2,
      complete: false,
      importError: null,
      pages: 1,
    });
    expect(
      prisma.smarterMailStatsImportState.updateMany,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalImported: 61,
          failures: 0,
          importError: null,
          leaseToken: null,
          nextRunAt: expect.any(Date),
        }),
      }),
    );
    const final =
      prisma.smarterMailStatsImportState.updateMany.mock.lastCall![0].data;
    expect((final.nextRunAt as Date).getTime()).toBeLessThan(Date.now() + 1000);
    expect(prisma.smarterMailStatsFolderState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          folderId: "Inbox",
          emailAccount: expect.objectContaining({
            smarterMailStatsImportState: expect.objectContaining({
              leaseToken: expect.any(String),
            }),
          }),
        }),
        data: { updatedAt: expect.any(Date) },
      }),
    );
  });
  it.each([
    "none",
    "uid",
    "cursor",
  ] as const)("backs off a no-message deadline unless UID checkpoints advanced (%s)", async (kind) => {
    const deadline = new AbortController();
    deadline.abort(new DOMException("Deadline", "TimeoutError"));
    vi.mocked(getSmarterMailLocalSyncContext).mockReturnValue({
      emailAccountId: "account",
      priority: "backfill",
      signal: deadline.signal,
    });
    const error = new Error("Request aborted");
    error.name = "AbortError";
    vi.mocked(importSmarterMailNewUids).mockRejectedValue(error);
    if (kind === "uid")
      prisma.smarterMailStatsUid.aggregate
        .mockResolvedValueOnce({
          _count: { _all: 100 },
          _max: { lastCheckedAt: null },
        } as never)
        .mockResolvedValueOnce({
          _count: { _all: 5000 },
          _max: { lastCheckedAt: null },
        } as never);
    if (kind === "cursor")
      prisma.smarterMailStatsFolderState.findUniqueOrThrow
        .mockResolvedValueOnce(folder as never)
        .mockResolvedValueOnce({
          ...folder,
          uidCursor: "next-folder-page",
        } as never);
    const result = await load();
    const final =
      prisma.smarterMailStatsImportState.updateMany.mock.lastCall![0].data;
    if (kind !== "none") {
      expect(result.pages).toBe(1);
      expect(final.failures).toBe(0);
      expect((final.nextRunAt as Date).getTime()).toBeLessThan(
        Date.now() + 1000,
      );
    } else {
      expect(result.pages).toBe(0);
      expect(final.failures).toEqual({ increment: 1 });
      expect(final.importError).toEqual(expect.any(String));
      expect((final.nextRunAt as Date).getTime()).toBeGreaterThanOrEqual(
        Date.now() + 59_000,
      );
    }
    expect(prisma.smarterMailStatsFolderState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { updatedAt: expect.any(Date) } }),
    );
  });
  it("does not classify a provider abort as expiry of its own request budget", async () => {
    const error = new Error("Provider aborted");
    error.name = "AbortError";
    vi.mocked(getSmarterMailLocalSyncContext).mockReturnValue({
      emailAccountId: "account",
      priority: "backfill",
      signal: new AbortController().signal,
    });
    vi.mocked(importSmarterMailNewUids).mockRejectedValue(error);
    await expect(load()).rejects.toThrow("Provider aborted");
    expect(
      prisma.smarterMailStatsImportState.updateMany,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failures: { increment: 1 },
          importError: expect.any(String),
        }),
      }),
    );
  });
});
