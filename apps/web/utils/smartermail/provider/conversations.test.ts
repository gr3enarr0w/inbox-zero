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
      if (operation === "search")
        return { results: [1, 2, 3].map((uid) => ({ uid, folder: "Inbox" })) };
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
  });
});
