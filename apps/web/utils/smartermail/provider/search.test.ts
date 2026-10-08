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
  it.each([
    "label",
    "sender",
  ])("reports an incomplete %s lookup instead of false-empty results after the folder cap", async (consumer) => {
    const { provider, request } = setup();
    const folders = Array.from({ length: 21 }, (_, index) => ({
      path: `Folder${String(index).padStart(2, "0")}`,
    }));
    request.mockImplementation(async (operation, body) =>
      operation === "folders"
        ? { folderList: folders }
        : body?.folder === "Folder20"
          ? { results: [{ uid: 1 }] }
          : { results: [] },
    );
    const lookup =
      consumer === "label"
        ? provider.getThreadsWithLabel({
            labelId: "sm-category:Receipts",
            maxResults: 5,
          })
        : provider.getThreadsFromSenderWithSubject("sender@example.com", 5);
    await expect(lookup).rejects.toThrow("incomplete");
    const searches = request.mock.calls.filter(
      ([operation]) => operation === "search",
    );
    expect(searches).toHaveLength(20);
    expect(searches.some(([, body]) => body?.folder === "Folder20")).toBe(
      false,
    );
    expect(searches[0]?.[1]).toMatchObject(
      consumer === "label"
        ? {
            categoryFilter: {
              filteredCategories: ["Receipts"],
              includeNoCategory: false,
            },
          }
        : { fieldsToSearch: 1, query: "sender@example.com" },
    );
  });
  it("returns genuinely exhausted empty one-shot searches", async () => {
    const { provider, request } = setup();
    request.mockImplementation(async (operation) =>
      operation === "folders"
        ? { folderList: [{ path: "Inbox" }] }
        : { results: [] },
    );
    await expect(
      provider.getThreadsWithLabel({ labelId: "sm-category:Receipts" }),
    ).resolves.toEqual([]);
    await expect(
      provider.getThreadsFromSenderWithSubject("sender@example.com", 5),
    ).resolves.toEqual([]);
  });
  it("preserves empty bounded pages and continuation for paginated search consumers", async () => {
    const { provider, request } = setup();
    request.mockImplementation(async (operation) =>
      operation === "folders"
        ? {
            folderList: Array.from({ length: 21 }, (_, index) => ({
              path: `Folder${index}`,
            })),
          }
        : { results: [] },
    );
    const result = await provider.searchThreads({ query: "" });
    expect(result.threads).toEqual([]);
    expect(result.nextPageToken).toMatch(/^sm-folders:/);
  });

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
  it.each([
    1, 2,
  ])("rejects cancellation during a detail read with %i result rows", async (count) => {
    const { provider, request } = setup();
    const controller = new AbortController();
    request
      .mockResolvedValueOnce({
        results: Array.from({ length: count }, (_, index) => ({
          uid: index + 1,
        })),
      })
      .mockImplementationOnce(async () => {
        controller.abort();
        return {
          messageData: {
            uid: 1,
            folder: "Inbox",
            date: "2026-10-06T12:00:00Z",
          },
        };
      });
    await expect(
      provider.searchMessages({
        query: "",
        folderId: "Inbox",
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(
      request.mock.calls.filter(([operation]) => operation === "message"),
    ).toHaveLength(1);
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
