import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import type { EmailProvider } from "@/utils/email/types";
import { getSmarterMailMailboxSyncPage } from "./mailbox-sync";
import { getSmarterMailMailboxSession } from "./mailbox-session";
import { pruneSmarterMailMailbox } from "./mailbox-prune";

vi.mock("@/utils/prisma");
vi.mock("./mailbox-session", () => ({
  getSmarterMailMailboxSession: vi.fn(),
  encodeSmarterMailMailboxCursor: (value: unknown) => JSON.stringify(value),
}));
vi.mock("./mailbox-prune", () => ({ pruneSmarterMailMailbox: vi.fn() }));
const list = vi.fn();
const verify = vi.fn();
const provider = {
  getMessagesWithPagination: list,
} as unknown as EmailProvider;
const input = {
  emailAccountId: "account",
  folderId: "Inbox",
  after: new Date(0),
  provider,
  limit: 25,
  verifyExistingIds: verify,
};

describe("bounded SmarterMail mailbox scan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSmarterMailMailboxSession).mockResolvedValue({
      session: { id: "session", after: new Date(0) },
      decoded: { sessionId: "session", generation: 1, phase: "scan" },
    } as never);
    list.mockResolvedValue({ messages: [], nextPageToken: "25" });
  });

  it("does not reconcile missing messages before a complete scan", async () => {
    const page = await getSmarterMailMailboxSyncPage(input);
    expect(page).toMatchObject({ hasMore: true, deletedMessageIds: [] });
    expect(JSON.parse(page.cursor)).toMatchObject({
      phase: "scan",
      pageToken: "25",
    });
    expect(pruneSmarterMailMailbox).not.toHaveBeenCalled();
  });

  it("moves to bounded pruning only when the folder scan is complete", async () => {
    list.mockResolvedValueOnce({ messages: [] });
    const page = await getSmarterMailMailboxSyncPage(input);
    expect(JSON.parse(page.cursor)).toMatchObject({ phase: "prune" });
    expect(pruneSmarterMailMailbox).not.toHaveBeenCalled();
  });

  it("starts the next snapshot only after pruning finishes and fences generation advances", async () => {
    vi.mocked(getSmarterMailMailboxSession).mockResolvedValueOnce({
      session: { id: "session", after: new Date(0) },
      decoded: { sessionId: "session", generation: 2, phase: "prune" },
    } as never);
    vi.mocked(pruneSmarterMailMailbox).mockResolvedValueOnce({
      removedMessageIds: ["old-folder-id"],
      hasMore: false,
    });
    const page = await getSmarterMailMailboxSyncPage(input);
    expect(page).toMatchObject({
      hasMore: false,
      removedMessageIds: ["old-folder-id"],
      deletedMessageIds: [],
    });
    expect(JSON.parse(page.cursor)).toMatchObject({
      phase: "scan",
      generation: 3,
    });
    expect(prisma.smarterMailMailboxSession.updateMany).toHaveBeenCalledWith({
      where: { id: "session", generation: 2 },
      data: { generation: { increment: 1 } },
    });
    expect(list).not.toHaveBeenCalled();
  });
});
