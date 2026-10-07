import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { hydrateImportedSenders } from "@/utils/categorize/senders/hydrate";
import { normalizeSmarterMailMessage } from "@/utils/smartermail/message";
vi.mock("@/utils/prisma");
vi.mock("server-only", () => ({}));
describe("imported sender hydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.emailAccount.findUniqueOrThrow.mockResolvedValue({
      email: "owner@example.com",
    });
    prisma.newsletter.findMany.mockResolvedValue([]);
    prisma.newsletter.createMany.mockResolvedValue({ count: 1 });
  });
  it("deduplicates received senders and excludes own, sent, draft and malformed addresses", async () => {
    const result = await hydrateImportedSenders({
      emailAccountId: "account",
      messages: [
        message("Alice <Sender@EXAMPLE.com>"),
        message("sender@example.com"),
        message("owner@example.com"),
        message("sent@example.com", ["SENT"]),
        message("draft@example.com", ["DRAFT"]),
        message("invalid"),
      ],
    });
    expect(result).toEqual({ created: 1 });
    expect(prisma.newsletter.createMany).toHaveBeenCalledWith({
      data: [
        {
          emailAccountId: "account",
          email: "sender@example.com",
          name: "Alice",
        },
      ],
      skipDuplicates: true,
    });
  });
  it("preserves existing manual categories, subscription status and display names across case variants", async () => {
    prisma.newsletter.findMany.mockResolvedValue([
      { email: "Sender@Example.com" },
    ]);
    await expect(
      hydrateImportedSenders({
        emailAccountId: "account",
        messages: [message("New name <sender@example.com>")],
      }),
    ).resolves.toEqual({ created: 0 });
    expect(prisma.newsletter.createMany).not.toHaveBeenCalled();
    expect(prisma.newsletter.updateMany).not.toHaveBeenCalled();
    expect(prisma.newsletter.upsert).not.toHaveBeenCalled();
    expect(prisma.newsletter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          emailAccountId: "account",
          email: { in: ["sender@example.com"], mode: "insensitive" },
        },
      }),
    );
  });
  it("keeps mixed message classifications uncategorized instead of assigning a whole-sender label", async () => {
    await hydrateImportedSenders({
      emailAccountId: "account",
      messages: [
        message("sender@example.com", ["Receipt"]),
        message("sender@example.com", ["Marketing"]),
      ],
    });
    expect(prisma.newsletter.createMany).toHaveBeenCalledWith({
      data: [
        { emailAccountId: "account", email: "sender@example.com", name: null },
      ],
      skipDuplicates: true,
    });
  });
  it("bounds pages before any database work", async () => {
    await expect(
      hydrateImportedSenders({
        emailAccountId: "account",
        messages: Array.from({ length: 26 }, () =>
          message("sender@example.com"),
        ),
      }),
    ).rejects.toThrow("exceeds 25");
    expect(prisma.emailAccount.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
function message(from: string, labels: string[] = []) {
  const result = normalizeSmarterMailMessage(
    {
      messageData: {
        uid: 1,
        folder: "Inbox",
        date: "2026-01-01T00:00:00Z",
        from,
      },
    },
    "Inbox",
    1,
  );
  result.labelIds = labels;
  return result;
}
