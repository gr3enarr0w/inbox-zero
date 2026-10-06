import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { createScopedLogger } from "@/utils/logger";
import { Prisma } from "@/generated/prisma/client";
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
const message: ParsedMessage = {
  id: "Inbox:1",
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
    } as never);
    list.mockResolvedValue({ messages: [message], nextPageToken: "25" });
    prisma.smarterMailSyncMessage.create.mockResolvedValue({} as never);
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

  it("deduplicates replayed queue deliveries without repeating actions", async () => {
    prisma.smarterMailSyncMessage.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    const result = await syncSmarterMailAccount("account", logger);
    expect(result).toMatchObject({ processed: 0, hasMore: true });
    expect(runRules).not.toHaveBeenCalled();
  });

  it("quarantines ambiguous action errors and still saves the page checkpoint", async () => {
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
        data: expect.objectContaining({ cursor: "25", leaseToken: null }),
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
});
