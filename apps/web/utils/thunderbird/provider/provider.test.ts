import { describe, it, expect, vi } from "vitest";
import { ThunderbirdProvider } from "@/utils/email/thunderbird";
import { ThunderbirdClient } from "@/utils/thunderbird/client";
import { thunderbirdMessageId } from "@/utils/thunderbird/message";
import { createScopedLogger } from "@/utils/logger";
vi.mock("server-only", () => ({}));
vi.mock("@/utils/thunderbird/sync-watch", () => ({}));
const message = {
  id: 7,
  folderId: "inbox",
  headerMessageId: "test@example.com",
  date: "2026-01-01T00:00:00.000Z",
  subject: "Public fixture",
  from: "sender@example.com",
  to: ["recipient@example.com"],
  read: false,
  flagged: false,
  hasAttachments: false,
  textPlain: "Test content",
};
const folders = [
  { id: "inbox", name: "Inbox", path: "/Inbox", specialUse: ["inbox"] },
  {
    id: "archive",
    name: "Archive",
    path: "/Archive",
    specialUse: ["archives"],
  },
  {
    id: "class",
    name: "Classification",
    path: "/Classification",
    specialUse: [],
  },
  { id: "draft", name: "Drafts", path: "/Drafts", specialUse: ["drafts"] },
];
describe("Thunderbird scoped provider", () => {
  it("reads account-wide pages without silently defaulting to Inbox", async () => {
    const { provider, request } = fixture();
    request.mockImplementation(async (op) =>
      op === "listFolders"
        ? { folders }
        : { messages: [{ ...message, folderId: "archive" }] },
    );
    const page = await provider.getMessagesWithPagination({ maxResults: 25 });
    expect(page.messages[0]?.parentFolderId).toBe("archive");
    expect(
      request.mock.calls.find((call) => call[0] === "listMessages")?.[1],
    ).toEqual({ maxResults: 25, query: {} });
  });
  it("hydrates bodyless search summaries and preserves opaque continuation", async () => {
    const { provider, request } = fixture();
    request.mockImplementation(async (op) =>
      op === "listFolders"
        ? { folders }
        : op === "getMessage"
          ? { message }
          : {
              messages: [{ ...message, textPlain: undefined }],
              nextPageToken: "opaque",
            },
    );
    const page = await provider.searchMessages({ query: "invoice" });
    expect(page.messages[0]?.textPlain).toBe("Test content");
    expect(page.nextPageToken).toBe("opaque");
  });
  it("rejects conflicting folder predicates rather than dropping one", async () => {
    const { provider, request } = fixture();
    request.mockResolvedValue({ folders });
    await expect(
      provider.searchMessages({
        query: "in:inbox",
        mailboxSearch: { mailbox: "archive" },
      }),
    ).rejects.toThrow("conflicting search folders");
    expect(request.mock.calls.some((call) => call[0] === "listMessages")).toBe(
      false,
    );
  });

  it("rejects foreign mailbox references before any request", async () => {
    const { provider, request } = fixture();
    await expect(
      provider.getMessage(thunderbirdMessageId("other", message)),
    ).rejects.toThrow("scope");
    expect(request).not.toHaveBeenCalled();
  });
  it("accepts a resolved stale numeric id only with an exact anchor", async () => {
    const { provider, request, id } = fixture();
    request.mockImplementation(async (op) =>
      op === "listFolders" ? { folders } : { message: { ...message, id: 70 } },
    );
    const result = await provider.getMessage(id);
    expect(result.textPlain).toBe("Test content");
    expect(result.id).toBe(
      thunderbirdMessageId("account", { ...message, id: 70 }),
    );
  });
  it.each([
    { headerMessageId: "other@example.com" },
    { subject: "Other subject" },
    { date: "2026-02-01T00:00:00.000Z" },
  ])("refuses anchor mismatch before writes", async (patch) => {
    const { provider, request, id } = fixture();
    request.mockResolvedValue({ message: { ...message, ...patch } });
    await expect(provider.markRead(id)).rejects.toThrow("identity");
    expect(request.mock.calls.map((call) => call[0])).toEqual(["getMessage"]);
  });
  it("never expands destructive writes through supplied reply headers", async () => {
    const { provider, request, id } = fixture();
    request.mockImplementation(async (op, body) =>
      op === "listFolders"
        ? { folders }
        : {
            message: {
              ...message,
              inReplyTo: "<victim@example.com>",
              read: op === "updateMessage" ? Boolean(body?.read) : false,
            },
          },
    );
    await provider.markRead(id);
    expect(
      request.mock.calls.filter((call) => call[0] === "updateMessage"),
    ).toHaveLength(1);
    expect(
      request.mock.calls.find((call) => call[0] === "updateMessage")?.[1]
        ?.messageId,
    ).toBe(7);
    expect(request.mock.calls.some((call) => call[0] === "listMessages")).toBe(
      false,
    );
  });
  it("preserves a classification folder during a subsequent archive", async () => {
    const { provider, request, id } = fixture();
    request.mockImplementation(async (op) =>
      op === "listFolders"
        ? { folders }
        : { message: { ...message, folderId: "class" } },
    );
    await provider.archiveMessage(id);
    expect(request.mock.calls.some((call) => call[0] === "moveMessage")).toBe(
      false,
    );
  });
  it("blocks unsupported send and draft updates before IO", async () => {
    const { provider, request, id } = fixture();
    await expect(provider.sendDraft(id)).rejects.toThrow("sending");
    await expect(provider.updateDraft(id, { subject: "New" })).rejects.toThrow(
      "updating",
    );
    expect(request).not.toHaveBeenCalled();
  });
  it("rejects messages returned outside a requested folder", async () => {
    const { provider, request } = fixture();
    request.mockImplementation(async (op) =>
      op === "listFolders"
        ? { folders }
        : { messages: [{ ...message, folderId: "archive" }] },
    );
    await expect(
      provider.getMessagesWithPagination({ inboxOnly: true }),
    ).rejects.toThrow("folder scope");
  });
  it("creates and validates a plain-text reply draft", async () => {
    const { provider, request, id } = fixture();
    request.mockImplementation(async (op) =>
      op === "listFolders"
        ? { folders }
        : op === "getMessage"
          ? { message }
          : {
              draftId: 8,
              message: {
                ...message,
                id: 8,
                folderId: "draft",
                headerMessageId: "draft@example.com",
              },
            },
    );
    const draft = await provider.createDraft({
      to: "recipient@example.com",
      subject: "Reply",
      messageHtml: "<p>Hello</p>",
      replyToMessageId: id,
    });
    expect(draft.id.startsWith("tb:")).toBe(true);
    expect(
      request.mock.calls.find((call) => call[0] === "createDraft")?.[1],
    ).toMatchObject({
      replyToId: 7,
      to: ["recipient@example.com"],
      textPlain: "Hello",
    });
  });
  it("rejects unsupported predicates without widening the search", async () => {
    const { provider, request } = fixture();
    await expect(
      provider.searchMessages({ query: "subject:invoice" }),
    ).rejects.toThrow("operator");
    expect(request).not.toHaveBeenCalled();
  });
});
function fixture() {
  const client = new ThunderbirdClient({
    baseUrl: "http://127.0.0.1:8787",
    token: "x".repeat(32),
    accountId: "account",
  });
  const request = vi.spyOn(client, "request");
  return {
    provider: new ThunderbirdProvider(
      client,
      createScopedLogger("thunderbird-test"),
      "account-row",
    ),
    request,
    id: thunderbirdMessageId("account", message),
  };
}
