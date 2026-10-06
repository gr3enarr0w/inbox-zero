import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { pruneSmarterMailMailbox } from "./mailbox-prune";

vi.mock("@/utils/prisma");
const verify = vi.fn();

describe("SmarterMail folder removal reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.smarterMailMailboxMessage.updateMany.mockResolvedValue({ count: 1 });
    prisma.smarterMailMailboxMessage.findMany.mockResolvedValue([
      { messageId: "present", missingScans: 2 },
      { messageId: "first-miss", missingScans: 0 },
      { messageId: "confirmed-missing", missingScans: 1 },
    ] as never);
    verify.mockResolvedValue(["present"]);
  });

  it("only removes messages absent in two scans and verified absent by the server", async () => {
    const result = await pruneSmarterMailMailbox("session", 3, 25, verify);
    expect(result.removedMessageIds).toEqual(["confirmed-missing"]);
    expect(verify).toHaveBeenCalledWith([
      "present",
      "first-miss",
      "confirmed-missing",
    ]);
    expect(prisma.smarterMailMailboxMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sessionId: "session",
          messageId: { in: ["present"] },
        }),
        data: expect.objectContaining({ generation: 3, missingScans: 0 }),
      }),
    );
  });

  it("fails closed on unavailable or malformed presence responses", async () => {
    verify.mockRejectedValueOnce(new Error("presence response invalid"));
    await expect(
      pruneSmarterMailMailbox("session", 3, 25, verify),
    ).rejects.toThrow("presence response invalid");
    expect(prisma.smarterMailMailboxMessage.updateMany).not.toHaveBeenCalled();
  });
  it("replays verified tombstones after a lost removal response", async () => {
    prisma.smarterMailMailboxMessage.findMany.mockResolvedValue([
      { messageId: "removed", missingScans: 2, removed: true },
    ] as never);
    verify.mockResolvedValue([]);
    expect(
      (await pruneSmarterMailMailbox("session", 4, 25, verify))
        .removedMessageIds,
    ).toEqual(["removed"]);
    expect(prisma.smarterMailMailboxMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ removed: false }),
      }),
    );
  });

  it("resumes pruning in bounded batches without returning a completed cursor too early", async () => {
    expect(
      (await pruneSmarterMailMailbox("session", 3, 3, verify)).hasMore,
    ).toBe(true);
    expect(
      (await pruneSmarterMailMailbox("session", 3, 25, verify)).hasMore,
    ).toBe(false);
  });
});
