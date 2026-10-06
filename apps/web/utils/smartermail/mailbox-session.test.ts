import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import {
  encodeSmarterMailMailboxCursor,
  getSmarterMailMailboxSession,
} from "./mailbox-session";
import { InvalidMailboxSyncCursorError } from "@/utils/email/mailbox-sync";

vi.mock("@/utils/prisma");
const sessionId = "02996dbe-c7ee-4c50-a913-8b731680213a";
const cursor = encodeSmarterMailMailboxCursor({
  sessionId,
  generation: 2,
  phase: "scan",
  pageToken: "50",
});

describe("durable SmarterMail mailbox cursor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resumes the durable generation and page after recreating a provider", async () => {
    prisma.smarterMailMailboxSession.findFirst.mockResolvedValue({
      id: sessionId,
      emailAccountId: "account",
      folderId: "Inbox",
      generation: 2,
    } as never);
    const { decoded } = await getSmarterMailMailboxSession({
      emailAccountId: "account",
      folderId: "Inbox",
      cursor,
    });
    expect(decoded).toMatchObject({ generation: 2, pageToken: "50" });
    expect(prisma.smarterMailMailboxSession.findFirst).toHaveBeenCalledWith({
      where: {
        id: sessionId,
        emailAccountId: "account",
        folderId: "Inbox",
      },
    });
  });

  it("rejects cursors for a different account or folder", async () => {
    prisma.smarterMailMailboxSession.findFirst.mockResolvedValue(null);
    await expect(
      getSmarterMailMailboxSession({
        emailAccountId: "other",
        folderId: "Archive",
        cursor,
      }),
    ).rejects.toBeInstanceOf(InvalidMailboxSyncCursorError);
    expect(prisma.smarterMailMailboxSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          emailAccountId: "other",
          folderId: "Archive",
        }),
      }),
    );
  });

  it("recovers a lost completion response by restarting the persisted generation", async () => {
    prisma.smarterMailMailboxSession.findFirst.mockResolvedValue({
      id: sessionId,
      emailAccountId: "account",
      folderId: "Inbox",
      generation: 3,
    } as never);
    const result = await getSmarterMailMailboxSession({
      emailAccountId: "account",
      folderId: "Inbox",
      cursor,
    });
    expect(result).toMatchObject({
      recovered: true,
      decoded: { generation: 3, phase: "scan" },
    });
    expect(result.decoded.pageToken).toBeUndefined();
  });

  it("limits clients per folder instead of blocking mailboxes with many folders", async () => {
    prisma.smarterMailMailboxSession.count.mockResolvedValue(0);
    prisma.smarterMailMailboxSession.create.mockResolvedValue({
      id: sessionId,
      generation: 1,
      after: new Date(0),
    } as never);
    await getSmarterMailMailboxSession({
      emailAccountId: "account",
      folderId: "Folder21",
      after: new Date(0),
    });
    expect(prisma.smarterMailMailboxSession.count).toHaveBeenCalledWith({
      where: { emailAccountId: "account", folderId: "Folder21" },
    });
  });

  it("rejects malformed cursors before accessing mailbox state", async () => {
    await expect(
      getSmarterMailMailboxSession({
        emailAccountId: "account",
        folderId: "Inbox",
        cursor: "invalid",
      }),
    ).rejects.toBeInstanceOf(InvalidMailboxSyncCursorError);
    expect(prisma.smarterMailMailboxSession.findFirst).not.toHaveBeenCalled();
  });
});
