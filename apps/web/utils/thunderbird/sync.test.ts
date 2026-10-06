import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { createScopedLogger } from "@/utils/logger";
import { ActionType } from "@/generated/prisma/enums";
import { runRules } from "@/utils/ai/choose-rule/run-rules";
import { createEmailProvider } from "@/utils/email/provider";
import { getWebhookEmailAccount } from "@/utils/webhook/validate-webhook-account";
import type { ParsedMessage } from "@/utils/types";
import { syncThunderbirdAccount } from "./sync";
import { getThunderbirdSyncMessageKey } from "./sync-processing";

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
const logger = createScopedLogger("thunderbird-sync-test");
const list = vi.fn();
const read = vi.fn();
const message: ParsedMessage = {
  id: "native-1",
  threadId: "native-1",
  historyId: "",
  date: "2026-01-01",
  subject: "Example",
  snippet: "",
  inline: [],
  headers: {
    from: "sender@example.com",
    to: "recipient@example.com",
    subject: "Example",
    date: "2026-01-01",
    "message-id": "<one@example.com>",
  },
};
const key = getThunderbirdSyncMessageKey("account", message);

describe("Thunderbird bounded polling", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prisma.thunderbirdSyncState.updateMany.mockResolvedValue({ count: 1 });
    prisma.thunderbirdSyncState.findUniqueOrThrow.mockResolvedValue({
      cursor: "old-page",
      failures: 0,
    } as never);
    prisma.emailAccount.findUniqueOrThrow.mockResolvedValue({
      email: "recipient@example.com",
    } as never);
    vi.mocked(getWebhookEmailAccount).mockResolvedValue({
      id: "account",
      account: { provider: "thunderbird", disconnectedAt: null },
      user: { premium: null },
      rules: [
        {
          id: "rule",
          actions: [
            { type: ActionType.LABEL },
            { type: ActionType.SEND_EMAIL },
          ],
        },
      ],
    } as never);
    vi.mocked(createEmailProvider).mockResolvedValue({
      getMessagesWithPagination: list,
      getMessage: read,
    } as never);
    list.mockResolvedValue({ messages: [message], nextPageToken: "next-page" });
    read.mockResolvedValue(message);
    prisma.thunderbirdSyncMessage.createMany.mockResolvedValue({ count: 1 });
    prisma.thunderbirdSyncMessage.findMany.mockResolvedValue([
      { messageId: message.id, messageKey: key },
    ] as never);
    prisma.thunderbirdSyncMessage.count.mockResolvedValue(0);
    prisma.thunderbirdSyncMessage.updateMany.mockResolvedValue({ count: 1 });
    vi.mocked(runRules).mockResolvedValue([]);
  });

  it("does not read or execute when another worker owns the account", async () => {
    prisma.thunderbirdSyncState.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await syncThunderbirdAccount("account", logger)).toEqual({
      skipped: true,
    });
    expect(list).not.toHaveBeenCalled();
    expect(runRules).not.toHaveBeenCalled();
  });

  it("checkpoints discovery and executes only permitted actions under a scoped lease", async () => {
    expect(await syncThunderbirdAccount("account", logger)).toEqual({
      processed: 1,
      hasMore: true,
    });
    expect(list).toHaveBeenCalledWith({
      inboxOnly: true,
      maxResults: 25,
      pageToken: "old-page",
    });
    expect(prisma.thunderbirdSyncState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          emailAccountId: "account",
          leaseToken: expect.any(String),
        }),
        data: { cursor: "next-page" },
      }),
    );
    expect(runRules).toHaveBeenCalledWith(
      expect.objectContaining({
        rules: [
          expect.objectContaining({ actions: [{ type: ActionType.LABEL }] }),
        ],
      }),
    );
    expect(prisma.thunderbirdSyncMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          emailAccountId: "account",
          status: "queued",
          emailAccount: expect.objectContaining({
            thunderbirdSyncState: expect.objectContaining({
              leaseToken: expect.any(String),
              leaseUntil: { gt: expect.any(Date) },
            }),
          }),
        }),
        data: { status: "claimed" },
      }),
    );
  });

  it("resets an expired native continuation without replaying completed work", async () => {
    list.mockRejectedValueOnce({ code: "STALE_PAGE" });
    prisma.thunderbirdSyncMessage.findMany.mockResolvedValue([]);
    await syncThunderbirdAccount("account", logger);
    expect(list).toHaveBeenLastCalledWith({ inboxOnly: true, maxResults: 25 });
    expect(prisma.thunderbirdSyncMessage.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(runRules).not.toHaveBeenCalled();
  });

  it("continues after pre-action read failure but quarantines ambiguous action failure", async () => {
    const second = {
      ...message,
      id: "native-2",
      headers: { ...message.headers, "message-id": "<two@example.com>" },
    };
    const secondKey = getThunderbirdSyncMessageKey("account", second);
    prisma.thunderbirdSyncMessage.findMany.mockResolvedValue([
      { messageId: message.id, messageKey: key },
      { messageId: second.id, messageKey: secondKey },
    ] as never);
    read
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(second);
    vi.mocked(runRules).mockRejectedValueOnce(new Error("Response lost"));
    await syncThunderbirdAccount("account", logger);
    expect(runRules).toHaveBeenCalledTimes(1);
    expect(prisma.thunderbirdSyncMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          messageKey: key,
          status: "queued",
          emailAccount: expect.any(Object),
        }),
        data: expect.objectContaining({ status: "retry_ready" }),
      }),
    );
    expect(prisma.thunderbirdSyncMessage.updateMany).toHaveBeenCalledWith({
      where: {
        emailAccountId: "account",
        messageKey: secondKey,
        status: "claimed",
      },
      data: { status: "review_required", processedAt: expect.any(Date) },
    });
  });

  it("does not execute when the queued claim loses its lease", async () => {
    prisma.thunderbirdSyncMessage.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await syncThunderbirdAccount("account", logger);
    expect(runRules).not.toHaveBeenCalled();
    expect(prisma.thunderbirdSyncMessage.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          emailAccountId: "account",
          status: "claimed",
          emailAccount: {
            thunderbirdSyncState: expect.objectContaining({
              leaseToken: expect.any(String),
              leaseUntil: { gt: expect.any(Date) },
            }),
          },
        }),
        data: expect.objectContaining({ status: "review_required" }),
      }),
    );
  });

  it("never executes a changed identity under an old discovery marker", async () => {
    read.mockResolvedValue({ ...message, subject: "Changed" });
    await syncThunderbirdAccount("account", logger);
    expect(runRules).not.toHaveBeenCalled();
  });

  it("stops before reading queued mail when its lease has expired", async () => {
    prisma.thunderbirdSyncState.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    expect(await syncThunderbirdAccount("account", logger)).toEqual({
      skipped: true,
    });
    expect(read).not.toHaveBeenCalled();
    expect(runRules).not.toHaveBeenCalled();
  });

  it("does not enroll sending-only rules into automatic processing", async () => {
    vi.mocked(getWebhookEmailAccount).mockResolvedValue({
      id: "account",
      account: { provider: "thunderbird", disconnectedAt: null },
      user: { premium: null },
      rules: [{ actions: [{ type: ActionType.SEND_EMAIL }] }],
    } as never);
    await syncThunderbirdAccount("account", logger);
    expect(createEmailProvider).not.toHaveBeenCalled();
    expect(runRules).not.toHaveBeenCalled();
  });

  it("deduplicates native IDs across moves/restarts, retaining account and RFC identity", () => {
    expect(
      getThunderbirdSyncMessageKey("account", { ...message, id: "new-native" }),
    ).toBe(key);
    expect(getThunderbirdSyncMessageKey("other-account", message)).not.toBe(
      key,
    );
    expect(
      getThunderbirdSyncMessageKey("account", {
        ...message,
        date: "2026-01-02",
      }),
    ).not.toBe(key);
    expect(() =>
      getThunderbirdSyncMessageKey("account", {
        ...message,
        headers: { ...message.headers, "message-id": "" },
      }),
    ).toThrow("durable identity");
  });
});
