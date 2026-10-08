import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/prisma";
import { createScopedLogger } from "@/utils/logger";
import { getSenderEmailStats } from "./sender-stats";

vi.mock("@/utils/prisma");

describe("current sender aggregates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps retained metadata outside current sender counts using an account-scoped SQL predicate", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
    await getSenderEmailStats({
      emailAccountId: "account",
      logger: createScopedLogger("sender-stats-test"),
    });
    const query = vi.mocked(prisma.$queryRaw).mock.calls[0][0] as {
      text: string;
      values: unknown[];
    };
    expect(query.text).toContain('"removedAt" IS NULL');
    expect(query.text).toContain('"emailAccountId" =');
    expect(query.values).toContain("account");
    expect(prisma.emailMessage.deleteMany).not.toHaveBeenCalled();
  });
});
