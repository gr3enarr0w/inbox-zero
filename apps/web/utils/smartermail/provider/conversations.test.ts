import { describe, it, expect, vi } from "vitest";
import { SmarterMailProvider } from "@/utils/email/smartermail";
import { SmarterMailClient } from "@/utils/smartermail/client";
import { createScopedLogger } from "@/utils/logger";
import { smarterMailMessageId } from "@/utils/smartermail/message";
vi.mock("server-only", () => ({}));
vi.mock("@/utils/smartermail/watch", () => ({}));

describe("SmarterMail conversation history", () => {
  it("reconstructs ancestor and reply context and rejects unrelated header search matches", async () => {
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com",
      tokens: { accessToken: "test", refreshToken: "test" },
    });
    const provider = new SmarterMailProvider(
      client,
      createScopedLogger("smartermail-history-test"),
      "fixture",
    );
    const details: Record<number, unknown> = {
      1: {
        date: "2026-01-01T00:00:00Z",
        header: "Message-ID: <root@example.com>",
        messagePlainText: "Original",
      },
      2: {
        date: "2026-01-02T00:00:00Z",
        header:
          "Message-ID: <reply@example.com>\r\nIn-Reply-To: <root@example.com>",
        messagePlainText: "Reply",
      },
      3: {
        date: "2026-01-03T00:00:00Z",
        header:
          "Message-ID: <unrelated@example.com>\r\nX-Other: <root@example.com>",
        messagePlainText: "Unrelated",
      },
    };
    vi.spyOn(client, "request").mockImplementation(async (operation, body) => {
      if (operation === "message")
        return { messageData: details[Number(body?.uid)] };
      if (operation === "folders")
        return { folderList: [{ path: "Inbox" }, { path: "Sent Items" }] };
      if (operation === "search") {
        if (!body?.folder) throw new Error("Server rejects empty folder");
        const uids = body.folder === "Sent Items" ? [1] : [2, 3];
        return { results: uids.map((uid) => ({ uid, folder: body.folder })) };
      }
      throw new Error("Unexpected operation");
    });
    const thread = await provider.getThread(smarterMailMessageId("Inbox", 2));
    expect(thread.messages.map((message) => message.textPlain)).toEqual([
      "Original",
      "Reply",
    ]);
    expect(
      await provider.getMessageByRfc822MessageId("<missing@example.com>"),
    ).toBeNull();
    vi.spyOn(provider, "searchMessages").mockResolvedValue({
      messages: thread.messages,
      nextPageToken: "remaining-folder-page",
    });
    await expect(
      provider.getThread(smarterMailMessageId("Inbox", 2), {
        complete: true,
      }),
    ).rejects.toThrow("bounded history window");
  });
  it("keeps all thread mutations scoped to the selected message despite forged References", async () => {
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com",
      tokens: { accessToken: "test", refreshToken: "test" },
    });
    const provider = new SmarterMailProvider(
      client,
      createScopedLogger("smartermail-mutation-scope-test"),
      "fixture",
    );
    const request = vi
      .spyOn(client, "request")
      .mockImplementation(async (operation, body) => {
        if (operation === "folders")
          return {
            folderList: [
              { path: "Inbox" },
              { path: "Archive" },
              { path: "Projects" },
            ],
          };
        if (operation === "search")
          return {
            results:
              body?.folder === "Inbox"
                ? [
                    { uid: 1, folder: "Inbox" },
                    { uid: 2, folder: "Inbox" },
                  ]
                : [],
          };
        if (operation === "message")
          return {
            messageData: {
              date: "2026-01-01T00:00:00Z",
              header:
                Number(body?.uid) === 1
                  ? "Message-ID: <trusted@example.com>"
                  : "Message-ID: <attacker@example.com>\r\nReferences: <trusted@example.com>",
            },
          };
        return { success: true };
      });
    const anchor = smarterMailMessageId("Inbox", 2);
    expect((await provider.getThread(anchor)).messages).toHaveLength(2);
    request.mockClear();
    await provider.archiveThread(anchor, "reader@example.com");
    await provider.archiveThreadWithLabel(
      anchor,
      "reader@example.com",
      "sm-category:Receipts",
    );
    await provider.trashThread(anchor);
    await provider.markReadThread(anchor, true);
    await provider.markSpam(anchor);
    await provider.markNotSpam(anchor);
    await provider.removeThreadLabels(anchor, ["sm-category:Receipts"]);
    await provider.moveThreadToFolder(anchor, "reader@example.com", "Projects");
    await provider.unarchiveThread(anchor);
    await provider.untrashThread(anchor);
    const mutations = request.mock.calls.filter(([operation]) =>
      [
        "moveMessages",
        "patchMessages",
        "deleteMessages",
        "patchMessageCategories",
      ].includes(operation),
    );
    expect(mutations).toHaveLength(11);
    for (const [, body] of mutations)
      expect(body?.uid ?? body?.uID).toEqual([2]);
    expect(
      request.mock.calls.some(
        ([operation]) => operation === "search" || operation === "message",
      ),
    ).toBe(false);
  });
});
