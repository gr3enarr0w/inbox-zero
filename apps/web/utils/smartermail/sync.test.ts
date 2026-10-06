import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { createScopedLogger } from "@/utils/logger";
import { smarterMailMessageId } from "./message";
import { SmarterMailMessageNotFoundError } from "./errors";
import type { ParsedMessage } from "@/utils/types";
import { runRules } from "@/utils/ai/choose-rule/run-rules";
import { createEmailProvider } from "@/utils/email/provider";
import { getWebhookEmailAccount } from "@/utils/webhook/validate-webhook-account";
import { syncSmarterMailAccount } from "./sync";
import { getSmarterMailSyncMessageKey } from "./sync-processing";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/prisma");
vi.mock("@/utils/email/provider", () => ({ createEmailProvider: vi.fn() }));
vi.mock("@/utils/ai/choose-rule/run-rules", () => ({ runRules: vi.fn() }));
vi.mock("@/utils/webhook/validate-webhook-account", () => ({
  getWebhookEmailAccount: vi.fn(),
}));
vi.mock("@/utils/premium", () => ({
  getUserTier: () => null,
  hasAiAccess: () => true,
}));

const logger = createScopedLogger("smartermail-sync-test");
const list = vi.fn();
afterEach(() => vi.restoreAllMocks());
const message: ParsedMessage = {
  id: smarterMailMessageId("Inbox", 1),
  threadId: "Inbox:1",
  historyId: "",
  date: "2026-01-01",
  snippet: "Test",
  subject: "Test",
  inline: [],
  headers: {
    date: "2026-01-01",
    from: "sender@example.com",
    to: "mailbox@example.com",
    subject: "Test",
    "message-id": "<one@example.com>",
  },
};

describe("SmarterMail polling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.smarterMailSyncState.updateMany.mockResolvedValue({ count: 1 });
    prisma.smarterMailSyncState.findUniqueOrThrow.mockResolvedValue({
      cursor: null,
      failures: 0,
    } as never);
    prisma.emailAccount.findUniqueOrThrow.mockResolvedValue({
      email: "mailbox@example.com",
    } as never);
    vi.mocked(getWebhookEmailAccount).mockResolvedValue({
      id: "account",
      account: { provider: "smartermail", disconnectedAt: null },
      rules: [{ id: "rule" }],
      user: { premium: null },
    } as never);
    vi.mocked(createEmailProvider).mockResolvedValue({
      getMessagesWithPagination: list,
      getMessage: vi.fn().mockResolvedValue(message),
      hasMessagesInFolder: vi.fn().mockResolvedValue([message.id]),
    } as never);
    list.mockResolvedValue({ messages: [message], nextPageToken: "25" });
    prisma.smarterMailSyncMessage.createMany.mockResolvedValue({ count: 1 });
    prisma.smarterMailSyncMessage.findMany.mockResolvedValue([
      {
        messageId: message.id,
        messageKey: getSmarterMailSyncMessageKey(message),
      },
    ] as never);
    prisma.smarterMailSyncMessage.updateMany.mockResolvedValue({ count: 1 });
    prisma.smarterMailSyncMessage.update.mockResolvedValue({} as never);
    vi.mocked(runRules).mockResolvedValue([]);
  });

  it("does not process an account already leased by another worker", async () => {
    prisma.smarterMailSyncState.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await syncSmarterMailAccount("account", logger)).toEqual({
      skipped: true,
    });
    expect(list).not.toHaveBeenCalled();
  });
  it.each([
    "backlog",
    "idle",
  ])("schedules a successful %s batch without delaying pending work", async (kind) => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    list.mockResolvedValue({
      messages: [],
      nextPageToken: kind === "backlog" ? "25" : undefined,
    });
    prisma.smarterMailSyncMessage.findMany.mockResolvedValue([]);
    const result = await syncSmarterMailAccount("account", logger);
    expect(result).toMatchObject({ hasMore: kind === "backlog" });
    expect(prisma.smarterMailSyncState.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nextRunAt: new Date(now + (kind === "backlog" ? 0 : 60_000)),
          failures: 0,
          leaseToken: null,
        }),
      }),
    );
  });

  it("deduplicates replayed queue deliveries without repeating actions", async () => {
    list.mockResolvedValueOnce({ messages: [message] });
    prisma.smarterMailSyncMessage.findMany.mockResolvedValueOnce([]);
    const result = await syncSmarterMailAccount("account", logger);
    expect(result).toMatchObject({ processed: 0, hasMore: false });
    expect(runRules).not.toHaveBeenCalled();
  });
  it.each([
    "full",
    "deadline",
  ])("bounds a larger processing batch by its %s limit", async (limit) => {
    let clock = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const messages = Array.from({ length: 70 }, (_, index) => ({
      ...message,
      id: smarterMailMessageId("Inbox", index + 1),
      headers: {
        ...message.headers,
        "message-id": `<${index + 1}@example.com>`,
      },
    }));
    prisma.smarterMailSyncState.findUniqueOrThrow.mockResolvedValue({
      cursor: "process",
      failures: 0,
    } as never);
    prisma.smarterMailSyncMessage.findMany.mockImplementation(
      async ({ take }) =>
        messages.slice(0, take).map((row) => ({
          messageId: row.id,
          messageKey: getSmarterMailSyncMessageKey(row),
        })) as never,
    );
    vi.mocked(createEmailProvider).mockResolvedValue({
      getMessage: async (id: string) => messages.find((row) => row.id === id),
      hasMessagesInFolder: async (_folder: string, ids: string[]) => ids,
    } as never);
    vi.mocked(runRules).mockImplementation(async () => {
      if (limit === "deadline") clock += 241_000;
      return [];
    });
    const result = await syncSmarterMailAccount("account", logger);
    expect(result).toMatchObject({
      processed: limit === "full" ? 50 : 1,
      hasMore: true,
    });
    expect(runRules).toHaveBeenCalledTimes(limit === "full" ? 50 : 1);
    expect(list).not.toHaveBeenCalled();
    expect(prisma.smarterMailSyncState.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cursor: "process",
          nextRunAt: new Date(clock),
          leaseToken: null,
        }),
      }),
    );
  });

  it("advances discovery after a clean timed stop instead of applying the crash rewind", async () => {
    let clock = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    prisma.smarterMailSyncMessage.findMany.mockResolvedValue(
      Array.from({ length: 50 }, () => ({
        messageId: message.id,
        messageKey: getSmarterMailSyncMessageKey(message),
      })) as never,
    );
    vi.mocked(runRules).mockImplementation(async () => {
      clock += 241_000;
      return [];
    });
    const result = await syncSmarterMailAccount("account", logger);
    expect(result).toMatchObject({ processed: 1, hasMore: true });
    expect(prisma.smarterMailSyncState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { cursor: "scan:0" } }),
    );
    expect(prisma.smarterMailSyncState.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cursor: "scan:25",
          nextRunAt: new Date(clock),
        }),
      }),
    );
  });
  it("quarantines ambiguous action errors and still saves the page checkpoint", async () => {
    list.mockResolvedValueOnce({ messages: [message] });
    vi.mocked(runRules).mockRejectedValueOnce(
      new Error("reply may have been sent"),
    );
    expect(await syncSmarterMailAccount("account", logger)).toMatchObject({
      reviewRequired: 1,
    });
    expect(prisma.smarterMailSyncMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "review_required" }),
      }),
    );
    expect(prisma.smarterMailSyncState.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cursor: null, leaseToken: null }),
      }),
    );
  });

  it("backs off account authentication failures without advancing the cursor", async () => {
    list.mockRejectedValueOnce(new Error("authentication failed"));
    await expect(syncSmarterMailAccount("account", logger)).rejects.toThrow(
      "retry schedule",
    );
    expect(prisma.smarterMailSyncState.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failures: 1, leaseToken: null }),
      }),
    );
    expect(runRules).not.toHaveBeenCalled();
  });

  it("deduplicates RFC IDs across folder moves, preserving case", () => {
    expect(getSmarterMailSyncMessageKey(message)).toBe(
      getSmarterMailSyncMessageKey({ ...message, id: "Archive:19" }),
    );
    expect(getSmarterMailSyncMessageKey(message)).not.toBe(
      getSmarterMailSyncMessageKey({
        ...message,
        headers: { ...message.headers, "message-id": "<One@example.com>" },
      }),
    );
  });
  it("processes queued mail during discovery and rebases offsets after archive", async () => {
    vi.mocked(createEmailProvider).mockResolvedValue({
      getMessagesWithPagination: list,
      getMessage: vi.fn().mockResolvedValue(message),
      hasMessagesInFolder: vi
        .fn()
        .mockResolvedValueOnce([message.id])
        .mockResolvedValueOnce([]),
    } as never);
    await syncSmarterMailAccount("account", logger);
    expect(runRules).toHaveBeenCalledOnce();
    expect(prisma.smarterMailSyncState.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cursor: "scan:24" }),
      }),
    );
    prisma.smarterMailSyncState.findUniqueOrThrow.mockResolvedValue({
      cursor: "scan:24",
      failures: 0,
    } as never);
    list.mockResolvedValueOnce({ messages: [] });
    prisma.smarterMailSyncMessage.findMany.mockResolvedValueOnce([]);
    await syncSmarterMailAccount("account", logger);
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ pageToken: "24" }),
    );
    expect(runRules).toHaveBeenCalledOnce();
  });
  it("resumes durable queued work after a restart without rescanning a mutated inbox", async () => {
    prisma.smarterMailSyncState.findUniqueOrThrow.mockResolvedValue({
      cursor: "process",
      failures: 0,
    } as never);
    await syncSmarterMailAccount("account", logger);
    expect(list).not.toHaveBeenCalled();
    expect(runRules).toHaveBeenCalledOnce();
    expect(prisma.smarterMailSyncMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "claimed",
          emailAccount: expect.objectContaining({
            smarterMailSyncState: expect.objectContaining({
              leaseToken: expect.any(String),
              leaseUntil: { gt: expect.any(Date) },
            }),
          }),
        }),
        data: expect.objectContaining({ status: "review_required" }),
      }),
    );
    expect(prisma.smarterMailSyncMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "queued",
          emailAccount: expect.objectContaining({
            smarterMailSyncState: expect.objectContaining({
              leaseToken: expect.any(String),
            }),
          }),
        }),
        data: { status: "claimed" },
      }),
    );
  });
  it("skips a queued reference whose fetched identity changed", async () => {
    prisma.smarterMailSyncState.findUniqueOrThrow.mockResolvedValue({
      cursor: "process",
      failures: 0,
    } as never);
    prisma.smarterMailSyncMessage.findMany.mockResolvedValue([
      { messageId: message.id, messageKey: "old-identity" },
    ] as never);
    await syncSmarterMailAccount("account", logger);
    expect(runRules).not.toHaveBeenCalled();
    expect(prisma.smarterMailSyncMessage.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          emailAccount: expect.objectContaining({
            smarterMailSyncState: expect.objectContaining({
              leaseToken: expect.any(String),
            }),
          }),
        }),
        data: expect.objectContaining({ status: "skipped" }),
      }),
    );
  });
  it("does not run queued actions after losing its lease", async () => {
    prisma.smarterMailSyncState.findUniqueOrThrow.mockResolvedValue({
      cursor: "process",
      failures: 0,
    } as never);
    prisma.smarterMailSyncMessage.updateMany.mockResolvedValue({ count: 0 });
    await syncSmarterMailAccount("account", logger);
    expect(runRules).not.toHaveBeenCalled();
    expect(prisma.smarterMailSyncMessage.update).not.toHaveBeenCalled();
  });
  it("traverses a large inbox while archiving and discovers arrivals without duplicate actions", async () => {
    const makeMessage = (uid: number) => ({
      ...message,
      id: smarterMailMessageId("Inbox", uid),
      headers: { ...message.headers, "message-id": `<${uid}@example.com>` },
    });
    let inbox = Array.from({ length: 55 }, (_, index) =>
      makeMessage(index + 1),
    );
    const markers = new Map<
      string,
      { messageId: string; messageKey: string; status: string }
    >();
    const state = { cursor: null as string | null, failures: 0 };
    prisma.smarterMailSyncState.findUniqueOrThrow.mockImplementation(
      async () => ({ ...state }) as never,
    );
    prisma.smarterMailSyncState.updateMany.mockImplementation(
      async ({ data }) => {
        if ("cursor" in data) state.cursor = data.cursor as string | null;
        return { count: 1 };
      },
    );
    prisma.smarterMailSyncMessage.createMany.mockImplementation(
      async ({ data }) => {
        for (const row of data as Array<{
          messageId: string;
          messageKey: string;
          status: string;
        }>)
          if (!markers.has(row.messageKey))
            markers.set(row.messageKey, { ...row });
        return { count: 1 };
      },
    );
    prisma.smarterMailSyncMessage.findMany.mockImplementation(
      async () =>
        [...markers.values()]
          .filter((row) => row.status === "queued")
          .slice(0, 25) as never,
    );
    prisma.smarterMailSyncMessage.updateMany.mockImplementation(
      async ({ where, data }) => {
        let count = 0;
        for (const row of markers.values())
          if (
            row.status === where.status &&
            (!where.messageKey || row.messageKey === where.messageKey)
          ) {
            row.status = data.status as string;
            count++;
          }
        return { count };
      },
    );
    prisma.smarterMailSyncMessage.update.mockImplementation(
      async ({ where, data }) => {
        markers.get(where.emailAccountId_messageKey!.messageKey)!.status =
          data.status as string;
        return {} as never;
      },
    );
    list.mockImplementation(async ({ pageToken }) => {
      const skip = Number(pageToken ?? 0);
      const messages = inbox.slice(skip, skip + 25);
      return {
        messages,
        nextPageToken: messages.length === 25 ? String(skip + 25) : undefined,
      };
    });
    vi.mocked(createEmailProvider).mockResolvedValue({
      getMessagesWithPagination: list,
      getMessage: async (id: string) => inbox.find((row) => row.id === id),
      hasMessagesInFolder: async (_folder: string, ids: string[]) =>
        ids.filter((id) => inbox.some((row) => row.id === id)),
    } as never);
    vi.mocked(runRules).mockImplementation(async ({ message: current }) => {
      inbox = inbox.filter((row) => row.id !== current.id);
      if (current.id === smarterMailMessageId("Inbox", 1))
        inbox.unshift(makeMessage(56));
      return [];
    });
    for (let job = 0; job < 6; job++)
      await syncSmarterMailAccount("account", logger);
    expect(runRules).toHaveBeenCalledTimes(56);
    expect(
      new Set(
        vi.mocked(runRules).mock.calls.map(([options]) => options.message.id),
      ).size,
    ).toBe(56);
    expect(inbox).toEqual([]);
  });
  it("persists a conservative rewind before actions so a lost completion cannot skip mail", async () => {
    vi.mocked(createEmailProvider).mockResolvedValue({
      getMessagesWithPagination: list,
      getMessage: vi.fn().mockResolvedValue(message),
      hasMessagesInFolder: vi
        .fn()
        .mockResolvedValueOnce([message.id])
        .mockRejectedValueOnce(new Error("worker lost after archive")),
    } as never);
    await expect(syncSmarterMailAccount("account", logger)).rejects.toThrow(
      "retry schedule",
    );
    expect(runRules).toHaveBeenCalledOnce();
    const rewind = prisma.smarterMailSyncState.updateMany.mock.calls.findIndex(
      ([args]) => args.data.cursor === "scan:24",
    );
    expect(rewind).toBeGreaterThan(-1);
    expect(
      prisma.smarterMailSyncState.updateMany.mock.invocationCallOrder[rewind],
    ).toBeLessThan(vi.mocked(runRules).mock.invocationCallOrder[0]);
    expect(
      prisma.smarterMailSyncState.updateMany.mock.calls[rewind][0].where,
    ).toMatchObject({
      leaseToken: expect.any(String),
      leaseUntil: { gt: expect.any(Date) },
    });
    expect(prisma.smarterMailSyncState.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ cursor: expect.anything() }),
      }),
    );
  });
  it.each([
    "absent",
    "read-race",
    "unknown",
    "identity",
  ])("rebases only confirmed absence for a skipped %s queued reference", async (outcome) => {
    const hasMessagesInFolder = vi.fn().mockResolvedValue([message.id]);
    const getMessage = vi.fn().mockResolvedValue(message);
    if (outcome === "absent") hasMessagesInFolder.mockResolvedValue([]);
    if (outcome === "read-race")
      getMessage.mockRejectedValue(new SmarterMailMessageNotFoundError());
    if (outcome === "unknown")
      getMessage.mockRejectedValue(new Error("normalization failed"));
    if (outcome === "identity")
      getMessage.mockResolvedValue({
        ...message,
        headers: {
          ...message.headers,
          "message-id": "<different@example.com>",
        },
      });
    vi.mocked(createEmailProvider).mockResolvedValue({
      getMessagesWithPagination: list,
      hasMessagesInFolder,
      getMessage,
    } as never);
    await syncSmarterMailAccount("account", logger);
    expect(runRules).not.toHaveBeenCalled();
    const absent = outcome === "absent" || outcome === "read-race";
    expect(prisma.smarterMailSyncState.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cursor: absent ? "scan:24" : "scan:25",
        }),
      }),
    );
    expect(prisma.smarterMailSyncMessage.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: outcome === "unknown" ? "retry_ready" : "skipped",
        }),
      }),
    );
  });
  it.each([
    "malformed",
    "presence",
    "message",
  ])("continues past a queued %s failure without running its rules", async (failure) => {
    prisma.smarterMailSyncState.findUniqueOrThrow.mockResolvedValue({
      cursor: "process",
      failures: 0,
    } as never);
    const badId =
      failure === "malformed" ? "invalid" : smarterMailMessageId("Inbox", 2);
    prisma.smarterMailSyncMessage.findMany.mockResolvedValue([
      { messageId: badId, messageKey: "bad" },
      {
        messageId: message.id,
        messageKey: getSmarterMailSyncMessageKey(message),
      },
    ] as never);
    const hasMessagesInFolder = vi.fn().mockResolvedValue([message.id]);
    const getMessage = vi.fn().mockResolvedValue(message);
    if (failure === "presence")
      hasMessagesInFolder.mockRejectedValueOnce(
        new Error("presence unavailable"),
      );
    if (failure === "message")
      getMessage.mockRejectedValueOnce(new Error("read unavailable"));
    vi.mocked(createEmailProvider).mockResolvedValue({
      getMessage,
      hasMessagesInFolder,
    } as never);
    const result = await syncSmarterMailAccount("account", logger);
    expect(result).toMatchObject({ processed: 1 });
    expect(runRules).toHaveBeenCalledOnce();
    expect(vi.mocked(runRules).mock.calls[0][0].message.id).toBe(message.id);
    expect(prisma.smarterMailSyncMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          emailAccountId: "account",
          messageKey: "bad",
          status: "queued",
          emailAccount: expect.objectContaining({
            smarterMailSyncState: expect.objectContaining({
              leaseToken: expect.any(String),
              leaseUntil: { gt: expect.any(Date) },
            }),
          }),
        }),
        data: expect.objectContaining({
          status: failure === "malformed" ? "skipped" : "retry_ready",
        }),
      }),
    );
  });
});
