import { describe, it, expect, vi } from "vitest";
import { SmarterMailProvider } from "@/utils/email/smartermail";
import { SmarterMailClient } from "@/utils/smartermail/client";
import { createScopedLogger } from "@/utils/logger";
vi.mock("server-only", () => ({}));
vi.mock("@/utils/smartermail/watch", () => ({}));

function setup() {
  const client = new SmarterMailClient({
    baseUrl: "https://mail.example.com",
    tokens: { accessToken: "test", refreshToken: "test" },
  });
  const request = vi.spyOn(client, "request");
  return {
    request,
    provider: new SmarterMailProvider(
      client,
      createScopedLogger("smartermail-search-test"),
      "fixture",
    ),
  };
}

describe("SmarterMail scoped search", () => {
  it("keeps inbox/category/date filters together instead of widening into all folders", async () => {
    const { provider, request } = setup();
    request
      .mockResolvedValueOnce({ folderList: [{ path: "Inbox" }] })
      .mockResolvedValueOnce({ results: [] });
    await provider.getThreadsWithQuery({
      query: {
        type: "inbox",
        category: "Receipts",
        after: new Date("2026-01-01T00:00:00Z"),
        isUnread: true,
      },
      maxResults: 10,
    });
    expect(request.mock.calls[1]).toEqual([
      "search",
      expect.objectContaining({
        folder: "Inbox",
        messagesSince: "2026-01-01T00:00:00.000Z",
        searchFlags: { 0: false },
        categoryFilter: {
          filteredCategories: ["Receipts"],
          includeNoCategory: false,
        },
      }),
    ]);
  });
  it("applies sender criteria as a separate structured field", async () => {
    const { provider, request } = setup();
    request.mockImplementation(async (operation) =>
      operation === "folders"
        ? { folderList: [{ path: "Inbox" }, { path: "Sent Items" }] }
        : { results: [] },
    );
    await provider.getMessagesFromSender({
      senderEmail: "sender@example.com",
      maxResults: 5,
    });
    expect(request).toHaveBeenCalledWith(
      "search",
      expect.objectContaining({
        fieldsToSearch: 1,
        query: "sender@example.com",
      }),
    );
  });
  it("visits owned folders explicitly for native global searches", async () => {
    const { provider, request } = setup();
    request.mockImplementation(async (operation) =>
      operation === "folders"
        ? { folderList: [{ path: "Inbox" }, { path: "Sent Items" }] }
        : { results: [] },
    );
    await provider.searchMessages({ query: "is:unread" });
    expect(
      request.mock.calls
        .filter(([operation]) => operation === "search")
        .map(([, body]) => body?.folder),
    ).toEqual(["Inbox", "Sent Items"]);
    expect(request.mock.calls[1]?.[1]).toMatchObject({
      query: "",
      searchFlags: { 0: false },
    });
  });
  it("translates assistant date filters into the scoped native request", async () => {
    const { provider, request } = setup();
    request
      .mockResolvedValueOnce({ folderList: [{ path: "Inbox" }] })
      .mockResolvedValueOnce({ results: [] });
    await provider.searchMessages({
      query: "in:inbox is:unread after:2026/10/06 before:2026/10/07",
    });
    expect(request.mock.calls[1]?.[1]).toMatchObject({
      query: "",
      folder: "Inbox",
      messagesSince: "2026-10-06T00:00:00.000Z",
      messagesBefore: "2026-10-07T00:00:00.000Z",
      searchFlags: { 0: false },
    });
  });
  it("rejects mixed sender and text searches instead of dropping a criterion", async () => {
    const { provider } = setup();
    await expect(
      provider.searchMessages({
        query: "invoice",
        fromEmail: "sender@example.com",
      }),
    ).rejects.toThrow("combining sender and text");
  });
  it("filters sender substring matches to the exact address without losing pagination", async () => {
    const { provider, request } = setup();
    request
      .mockResolvedValueOnce({ results: [{ uid: 1, folder: "Inbox" }] })
      .mockResolvedValueOnce({
        messageData: {
          uid: 1,
          folder: "Inbox",
          date: "2026-10-06T12:00:00Z",
          from: "different-sender@example.com",
        },
      });
    const page = await provider.searchMessages({
      query: "",
      fromEmail: "sender@example.com",
      maxResults: 1,
      folderId: "Inbox",
    });
    expect(page.messages).toEqual([]);
    expect(page.nextPageToken).toBe("1");
  });
  it("finds nested owned folders while excluding shared mailbox scope", async () => {
    const { provider, request } = setup();
    request.mockResolvedValue({
      folderList: [
        {
          path: "Inbox",
          subFolders: [
            { path: "Inbox/Receipts", totalMessages: 12, unread: 3 },
          ],
        },
        {
          path: "Shared",
          isMappedFolder: true,
          subFolders: [{ path: "Shared/Inbox" }],
        },
      ],
    });
    expect((await provider.getFolders()).map((folder) => folder.id)).toEqual([
      "Inbox",
      "Inbox/Receipts",
    ]);
  });
  it("supports native category and starred sidebar navigation without treating them as folder roles", async () => {
    const { provider, request } = setup();
    request.mockImplementation(async (operation) =>
      operation === "folders"
        ? { folderList: [{ path: "Inbox" }, { path: "Sent Items" }] }
        : { results: [] },
    );
    await provider.getThreadsWithQuery({
      query: { type: "label", labelId: "sm-category:Receipts" },
    });
    expect(request).toHaveBeenCalledWith(
      "search",
      expect.objectContaining({
        categoryFilter: {
          filteredCategories: ["Receipts"],
          includeNoCategory: false,
        },
      }),
    );
    await provider.getThreadsWithQuery({ query: { type: "starred" } });
    expect(request).toHaveBeenCalledWith(
      "search",
      expect.objectContaining({ searchFlags: { 4: true } }),
    );
  });
});
