import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { createScopedLogger } from "@/utils/logger";
import { saveParsedEmailMessages } from "@/utils/actions/stats-messages";
import { hydrateImportedSenders } from "@/utils/categorize/senders/hydrate";
import { SmarterMailMessageNotFoundError } from "./errors";
import type { EmailProvider } from "@/utils/email/types";
import { reconcileSmarterMailStats } from "./stats-prune";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/prisma");
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
const getMessage = vi.fn();
const input = {
  emailAccountId: "account",
  generation: "pass",
  leaseToken: "owner-lease",
  after: new Date("2026-07-01"),
  before: new Date("2026-10-01"),
  emailProvider: { getMessage } as unknown as EmailProvider,
  logger: createScopedLogger("stats-prune-test"),
};
const message = {
  id: "existing-copy",
  internalDate: String(input.after.getTime()),
};

describe("verified SmarterMail statistics reconciliation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prisma.emailMessage.findMany.mockResolvedValue([
      { id: "row", messageId: message.id },
    ] as never);
    prisma.emailMessage.count.mockResolvedValue(0);
    prisma.$executeRaw.mockResolvedValue(1);
    getMessage.mockResolvedValue(message);
    vi.mocked(saveParsedEmailMessages).mockResolvedValue(1);
    vi.mocked(hydrateImportedSenders).mockResolvedValue({ created: 0 });
  });

  it("refreshes still-present rows skipped by offset traversal, preserving genuine copies", async () => {
    expect(await reconcileSmarterMailStats(input)).toEqual({ complete: true });
    expect(saveParsedEmailMessages).toHaveBeenCalledWith(
      "account",
      [message],
      input.logger,
      { generation: "pass", leaseToken: "owner-lease" },
    );
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.emailMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 20,
        where: {
          emailAccountId: "account",
          date: { gte: input.after, lte: input.before },
          OR: [
            { smarterMailStatsGeneration: null },
            { smarterMailStatsGeneration: { not: "pass" } },
          ],
        },
      }),
    );
  });

  it("deletes an old moved reference only after exact typed native absence", async () => {
    getMessage.mockRejectedValue(new SmarterMailMessageNotFoundError());
    await reconcileSmarterMailStats(input);
    expect(prisma.$executeRaw).toHaveBeenCalledOnce();
    expect(saveParsedEmailMessages).not.toHaveBeenCalled();
  });

  it("retains cached mail on transient read errors and leaves reconciliation incomplete", async () => {
    getMessage.mockRejectedValue(new Error("Server unavailable"));
    await expect(reconcileSmarterMailStats(input)).rejects.toThrow(
      "Server unavailable",
    );
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(saveParsedEmailMessages).not.toHaveBeenCalled();
  });

  it("does not delete or refresh an unvalidated native identity", async () => {
    getMessage.mockResolvedValue({ ...message, id: "different-mail" });
    await expect(reconcileSmarterMailStats(input)).rejects.toThrow("identity");
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(saveParsedEmailMessages).not.toHaveBeenCalled();
  });

  it("keeps progress pending when a lease-fenced absence deletion did not run", async () => {
    getMessage.mockRejectedValue(new SmarterMailMessageNotFoundError());
    prisma.$executeRaw.mockResolvedValue(0);
    prisma.emailMessage.count.mockResolvedValue(1);
    expect(await reconcileSmarterMailStats(input)).toEqual({ complete: false });
  });
});
