import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/prisma";
import { getEmailFieldStats } from "./helpers";

vi.mock("@/utils/prisma");

describe("current mailbox field statistics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("excludes retained moved/removed metadata and other accounts without deleting history", async () => {
    const stored = [
      {
        emailAccountId: "account",
        removedAt: null,
        sent: false,
        from: "current@example.com",
      },
      {
        emailAccountId: "account",
        removedAt: new Date(),
        sent: false,
        from: "history@example.com",
      },
      {
        emailAccountId: "other",
        removedAt: null,
        sent: false,
        from: "other@example.com",
      },
    ];
    vi.mocked(prisma.emailMessage.groupBy).mockImplementation(async (args) => {
      const where = args.where ?? {};
      const current = stored.filter(
        (row) =>
          row.emailAccountId === where.emailAccountId &&
          row.removedAt === where.removedAt &&
          row.sent === where.sent,
      );
      return current.map((row) => ({
        from: row.from,
        _count: { from: 1 },
      })) as never;
    });
    const result = await getEmailFieldStats({
      emailAccountId: "account",
      field: "from",
      isSent: false,
    });
    expect(result.data).toEqual([{ from: "current@example.com", count: 1 }]);
    expect(stored).toHaveLength(3);
    expect(prisma.emailMessage.deleteMany).not.toHaveBeenCalled();
  });
});
