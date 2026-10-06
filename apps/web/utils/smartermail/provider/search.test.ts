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
    request.mockResolvedValue({ results: [] });
    await provider.getMessagesFromSender({
      senderEmail: "sender@example.com",
      maxResults: 5,
    });
    expect(request).toHaveBeenCalledWith(
      "search",
      expect.objectContaining({
        searchFieldValueMap: { 1: "sender@example.com" },
        query: "",
      }),
    );
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
    request.mockResolvedValue({ results: [] });
    await provider.getThreadsWithQuery({
      query: { type: "label", labelId: "sm-category:Receipts" },
    });
    expect(request).toHaveBeenCalledWith(
      "search",
      expect.objectContaining({
        folder: "",
        categoryFilter: {
          filteredCategories: ["Receipts"],
          includeNoCategory: false,
        },
      }),
    );
    await provider.getThreadsWithQuery({ query: { type: "starred" } });
    expect(request).toHaveBeenCalledWith(
      "search",
      expect.objectContaining({ folder: "", searchFlags: { 4: true } }),
    );
  });
});
