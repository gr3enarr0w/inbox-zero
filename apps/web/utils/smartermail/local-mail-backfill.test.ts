import { describe, expect, it, vi } from "vitest";
import type { EmailProvider } from "@/utils/email/types";
import { getSmarterMailLocalBackfill } from "./local-mail-backfill";
import { InvalidMailboxSyncCursorError } from "@/utils/email/mailbox-sync";

const request = {
  phase: "folder-backfill",
  folderId: "Inbox",
  after: 0,
  before: 1000,
  limit: 25,
} as const;

describe("SmarterMail local backfill cursors", () => {
  it("binds a page token to account, folder, and date bounds", async () => {
    const list = vi
      .fn()
      .mockResolvedValue({ messages: [], nextPageToken: "25" });
    const provider = {
      getMessagesWithPagination: list,
    } as unknown as EmailProvider;
    const page = await getSmarterMailLocalBackfill(
      "account",
      provider,
      request,
    );
    await getSmarterMailLocalBackfill("account", provider, {
      ...request,
      cursor: page.nextCursor,
    });
    expect(list).toHaveBeenLastCalledWith({
      folderId: "Inbox",
      maxResults: 25,
      pageToken: "25",
    });
    list.mockClear();
    await expect(
      getSmarterMailLocalBackfill("other", provider, {
        ...request,
        cursor: page.nextCursor,
      }),
    ).rejects.toBeInstanceOf(InvalidMailboxSyncCursorError);
    await expect(
      getSmarterMailLocalBackfill("account", provider, {
        ...request,
        folderId: "Archive",
        cursor: page.nextCursor,
      }),
    ).rejects.toBeInstanceOf(InvalidMailboxSyncCursorError);
    await expect(
      getSmarterMailLocalBackfill("account", provider, {
        ...request,
        before: 2000,
        cursor: page.nextCursor,
      }),
    ).rejects.toBeInstanceOf(InvalidMailboxSyncCursorError);
    expect(list).not.toHaveBeenCalled();
  });
});
