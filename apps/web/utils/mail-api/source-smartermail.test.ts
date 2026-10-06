import { describe, expect, it, vi } from "vitest";
import { SmarterMailUnsupportedError } from "@/utils/smartermail/provider/error";
import { createEmailProviderMailboxSource } from "./source";
import type { EmailProvider } from "@/utils/email/types";

vi.mock("server-only", () => ({}));

vi.mock("@/utils/redis", () => ({ redis: { eval: vi.fn() } }));

describe("SmarterMail mailbox source scope", () => {
  it("discovers folder scopes and sends the folder identity with change polling", async () => {
    const getMailboxSyncPage = vi.fn().mockResolvedValue({
      cursor: "next",
      deletedMessageIds: [],
      upsertedMessages: [],
      hasMore: false,
      reset: false,
    });
    const source = createEmailProviderMailboxSource({
      accountId: "account",
      provider: {
        name: "smartermail",
        localMailSyncStrategy: "folder-delta",
        getFolders: vi.fn().mockResolvedValue([
          { id: "Inbox", childFolders: [] },
          { id: "Archive", childFolders: [] },
        ]),
        getMailboxSyncPage,
      } as unknown as EmailProvider,
    });
    expect(
      await source.discoverScopes({ signal: new AbortController().signal }),
    ).toMatchObject({
      status: "ok",
      value: {
        scopes: [
          { id: "Inbox", kind: "folder", folderId: "Inbox" },
          { id: "Archive", kind: "folder", folderId: "Archive" },
        ],
      },
    });
    await source.readChanges({
      position: {
        streamId: "Archive",
        checkpoint: "checkpoint",
        generation: "generation",
      },
      session: { accountId: "account", generation: "generation" },
      requestId: "request",
      pageSize: 20,
      signal: new AbortController().signal,
    });
    expect(getMailboxSyncPage).toHaveBeenCalledWith({
      cursor: "checkpoint",
      folderId: "Archive",
      limit: 20,
    });
  });
  it("does not repeatedly retry an unsupported complete conversation lookup", async () => {
    const source = createEmailProviderMailboxSource({
      accountId: "account",
      provider: {
        name: "smartermail",
        localMailSyncStrategy: "folder-delta",
        getThread: vi
          .fn()
          .mockRejectedValue(
            new SmarterMailUnsupportedError("complete conversation limit"),
          ),
      } as unknown as EmailProvider,
    });
    const result = await source.readConversationMembership({
      conversation: { accountId: "account", conversationId: "conversation" },
      session: { accountId: "account", generation: "generation" },
      resolutionId: "resolution",
      page: null,
      pageSize: 20,
      requestId: "request",
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ status: "ok", value: { status: "unsupported" } });
  });
});
