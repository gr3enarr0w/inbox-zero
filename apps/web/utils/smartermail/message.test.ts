import { describe, expect, it } from "vitest";
import {
  normalizeSmarterMailMessage,
  smarterMailMessageId,
  parseSmarterMailMessageId,
} from "@/utils/smartermail/message";

describe("SmarterMail message identity", () => {
  it("keeps identical UIDs in different folders distinct and preserves arbitrary paths", () => {
    const id = smarterMailMessageId("Projects/日本語: inbox", 42);
    expect(parseSmarterMailMessageId(id)).toEqual({
      folder: "Projects/日本語: inbox",
      uid: 42,
    });
    expect(smarterMailMessageId("Inbox", 42)).not.toBe(
      smarterMailMessageId("Archive", 42),
    );
    expect(() => parseSmarterMailMessageId(`${id}!`)).toThrow(
      "Invalid SmarterMail message reference",
    );
    expect(() => parseSmarterMailMessageId("42")).toThrow();
  });
  it("normalizes server metadata and folded headers for classification", () => {
    const message = normalizeSmarterMailMessage(
      {
        messageData: {
          date: "2026-01-02T12:00:00Z",
          subject: "Fixture",
          from: "sender@example.com",
          to: "reader@example.com",
          messagePlainText: "Hello\nworld",
          header:
            "Message-ID: <fixture@example.com>\r\nReferences: <parent@example.com>\r\n <older@example.com>\r\nList-Unsubscribe: <https://example.com/unsubscribe>",
          isSeen: false,
          categories: ["Receipts"],
        },
      },
      "Inbox",
      7,
      {
        from: { email: "sender@example.com", name: "Sender" },
        internalDate: "2026-01-03T12:00:00Z",
        isFlagged: true,
      },
    );
    expect(message.headers.references).toBe(
      "<parent@example.com> <older@example.com>",
    );
    expect(message.headers["message-id"]).toBe("<fixture@example.com>");
    expect(message.headers["list-unsubscribe"]).toBe(
      "<https://example.com/unsubscribe>",
    );
    expect(message.internalDate).toBe(
      String(Date.parse("2026-01-03T12:00:00Z")),
    );
    expect(message.labelIds).toEqual([
      "Inbox",
      "sm-category:Receipts",
      "INBOX",
      "UNREAD",
      "STARRED",
    ]);
    expect(message.textPlain).toBe("Hello\nworld");
  });
  it("rejects incomplete or corrupt messages rather than classifying empty content", () => {
    expect(() =>
      normalizeSmarterMailMessage({ results: [] }, "Inbox", 1),
    ).toThrow();
    expect(() =>
      normalizeSmarterMailMessage(
        { messageData: { date: "invalid" } },
        "Inbox",
        1,
      ),
    ).toThrow("invalid date");
  });
});
