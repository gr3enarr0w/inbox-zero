import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { retrySmarterMailSyncMessage } from "./retry-sync";

vi.mock("@/utils/prisma");

describe("safe SmarterMail retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.smarterMailSyncState.findUnique.mockResolvedValue({
      enabled: true,
      leaseUntil: null,
    } as never);
    prisma.executedRule.count.mockResolvedValue(0);
    prisma.smarterMailSyncMessage.deleteMany.mockResolvedValue({ count: 1 });
  });

  it("only clears the current account's confirmed pre-action failure", async () => {
    expect(await retrySmarterMailSyncMessage("account", "message")).toEqual({
      retried: 1,
    });
    expect(prisma.smarterMailSyncMessage.deleteMany).toHaveBeenCalledWith({
      where: {
        emailAccountId: "account",
        messageId: "message",
        status: "retry_ready",
      },
    });
    expect(prisma.smarterMailSyncState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { emailAccountId: "account", enabled: true },
        data: expect.objectContaining({
          cursor: null,
          failures: 0,
          retryAt: null,
        }),
      }),
    );
  });

  it("does not replay a message with a rule execution record", async () => {
    prisma.executedRule.count.mockResolvedValue(1);
    await expect(
      retrySmarterMailSyncMessage("account", "message"),
    ).rejects.toThrow("requires review");
    expect(prisma.smarterMailSyncMessage.deleteMany).not.toHaveBeenCalled();
  });

  it("does not release a marker during an active processing lease", async () => {
    prisma.smarterMailSyncState.findUnique.mockResolvedValue({
      enabled: true,
      leaseUntil: new Date(Date.now() + 60_000),
    } as never);
    await expect(
      retrySmarterMailSyncMessage("account", "message"),
    ).rejects.toThrow("current sync");
    expect(prisma.smarterMailSyncMessage.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects ambiguous or foreign-account markers without resetting the scan", async () => {
    prisma.smarterMailSyncMessage.deleteMany.mockResolvedValue({ count: 0 });
    await expect(
      retrySmarterMailSyncMessage("account", "message"),
    ).rejects.toThrow("before rule execution");
    expect(prisma.smarterMailSyncState.updateMany).not.toHaveBeenCalled();
  });
});
