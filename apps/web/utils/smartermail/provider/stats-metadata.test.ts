import { describe, expect, it, vi } from "vitest";
import {
  SmarterMailStatsMetadataInconclusiveError,
  fetchSmarterMailStatsMessages,
} from "./stats-metadata";
import {
  normalizeSmarterMailMessage,
  smarterMailMessageId,
} from "@/utils/smartermail/message";

import { SmarterMailProvider } from "@/utils/email/smartermail";
import { SmarterMailClient } from "@/utils/smartermail/client";
import { createScopedLogger } from "@/utils/logger";
vi.mock("server-only", () => ({}));
vi.mock("@/utils/smartermail/watch", () => ({}));

describe("SmarterMail statistics metadata batches", () => {
  it("downloads one metadata batch, preserves requested order and full-detail date/flags semantics", async () => {
    const rows = [row(2), { ...row(1), isSeen: true, isFlagged: true }];
    const request = vi.fn().mockResolvedValue({ success: true, results: rows });
    const ids = [1, 2].map((uid) => smarterMailMessageId("Inbox", uid));
    const messages = await fetchSmarterMailStatsMessages({ request }, ids);
    expect(messages.map((message) => message.id)).toEqual(ids);
    expect(messages[0].internalDate).toEqual(
      normalizeSmarterMailMessage({ messageData: rows[1] }, "Inbox", 1)
        .internalDate,
    );
    expect(messages[0].labelIds).toContain("STARRED");
    expect(messages[0].labelIds).not.toContain("UNREAD");
    expect(messages[1].labelIds).toContain("UNREAD");
    expect(messages[0].headers.to).toBe("Recipient <recipient@example.com>");
    expect(messages[0].textPlain).toBeUndefined();
    expect(messages[0].headers["message-id"]).toBeUndefined();
    expect(request.mock.calls).toEqual([
      [
        "messageMetadata",
        {
          messages: [1, 2].map((uid) => ({
            folder: "Inbox",
            uid,
            needLocation: false,
            isNew: false,
          })),
        },
      ],
    ]);
  });
  it.each([
    [],
    [row(1), row(1)],
    [{ ...row(1), folder: "Shared" }],
    [{ uid: 1, folder: "Inbox" }],
    [{ ...row(1), internalDate: "invalid" }],
    [{ ...row(1), from: { email: "" } }],
    [{ ...row(1), isSeen: "false" }],
    [row(1), row(2)],
  ])("rejects mismatched or inconclusive metadata without claiming absence", async (results) => {
    const request = vi.fn().mockResolvedValue({ success: true, results });
    await expect(
      fetchSmarterMailStatsMessages({ request }, [
        smarterMailMessageId("Inbox", 1),
      ]),
    ).rejects.toBeInstanceOf(SmarterMailStatsMetadataInconclusiveError);
  });
  it("does not convert transport failures into metadata fallback or absence", async () => {
    const error = new Error("unavailable");
    const request = vi.fn().mockRejectedValue(error);
    await expect(
      fetchSmarterMailStatsMessages({ request }, [
        smarterMailMessageId("Inbox", 1),
      ]),
    ).rejects.toBe(error);
  });
  it("bootstraps scoped date pages through metadata without downloading bodies", async () => {
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com",
      tokens: { accessToken: "test", refreshToken: "test" },
    });
    const request = vi
      .spyOn(client, "request")
      .mockResolvedValueOnce({ folderList: [{ path: "Inbox", guid: "owned" }] })
      .mockResolvedValueOnce({
        success: true,
        results: [{ uid: 1, folder: "Inbox" }],
      })
      .mockResolvedValueOnce({ success: true, results: [row(1)] });
    const provider = new SmarterMailProvider(
      client,
      createScopedLogger("metadata-test"),
      "account",
    );
    const after = new Date("2026-08-01T00:00:00Z");
    const page = await provider.getStatsMessagesWithPagination({
      folderId: "Inbox",
      maxResults: 1,
      after,
    });
    expect(page.nextPageToken).toBe("1");
    expect(page.messages).toHaveLength(1);
    expect(request.mock.calls.map((call) => call[0])).toEqual([
      "folders",
      "messages",
      "messageMetadata",
    ]);
    expect(request.mock.calls[1][1]).toMatchObject({
      folder: "Inbox",
      messagesSince: after.toISOString(),
      take: 1,
    });
  });
  it.each([
    { internalDate: "2026-09-01T00:00:00Z" },
    { ...row(1), uid: 2 },
    { ...row(1), folder: "Shared" },
  ])("rejects full-detail fallback without explicit matching identity", async (messageData) => {
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com",
      tokens: { accessToken: "test", refreshToken: "test" },
    });
    vi.spyOn(client, "request")
      .mockResolvedValueOnce({ folderList: [{ path: "Inbox" }] })
      .mockResolvedValueOnce({ success: true, messageData });
    const provider = new SmarterMailProvider(
      client,
      createScopedLogger("metadata-test"),
      "account",
    );
    await expect(
      provider.getStatsMessage(smarterMailMessageId("Inbox", 1)),
    ).rejects.toThrow();
  });
  it("rejects oversized or duplicate requests before native reads", async () => {
    const request = vi.fn();
    const id = smarterMailMessageId("Inbox", 1);
    await expect(
      fetchSmarterMailStatsMessages({ request }, [id, id]),
    ).rejects.toThrow();
    await expect(
      fetchSmarterMailStatsMessages(
        { request },
        Array.from({ length: 21 }, (_, index) =>
          smarterMailMessageId("Inbox", index + 1),
        ),
      ),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
function row(uid: number) {
  return {
    uid,
    folder: "Inbox",
    subject: "Example",
    from: { email: "sender@example.com", name: "Sender" },
    internalDate: "2026-09-01T10:00:00Z",
    dateSent: "2026-09-01T09:00:00Z",
    recipients: [{ email: "recipient@example.com", name: "Recipient" }],
  };
}
