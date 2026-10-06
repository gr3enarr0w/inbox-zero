import { describe, expect, it, vi } from "vitest";
import { SmarterMailProvider } from "@/utils/email/smartermail";
import { SmarterMailClient } from "@/utils/smartermail/client";
import { createScopedLogger } from "@/utils/logger";
import { smarterMailMessageId } from "@/utils/smartermail/message";
vi.mock("server-only", () => ({}));
vi.mock("@/utils/smartermail/watch", () => ({
  watchSmarterMailEmails: vi.fn(),
  unwatchSmarterMailEmails: vi.fn(),
}));

function fixtureProvider() {
  const client = new SmarterMailClient({
    baseUrl: "https://mail.example.com",
    tokens: { accessToken: "fixture", refreshToken: "fixture" },
  });
  const request = vi.spyOn(client, "request");
  const provider = new SmarterMailProvider(
    client,
    createScopedLogger("smartermail-test"),
    "fixture-account",
  );
  return { provider, request };
}

describe("SmarterMail provider", () => {
  it("hydrates inbox results before returning messages to the AI pipeline", async () => {
    const { provider, request } = fixtureProvider();
    request
      .mockResolvedValueOnce({
        folderList: [{ path: "Inbox", totalMessages: 2, unread: 1 }],
      })
      .mockResolvedValueOnce({ results: [{ uid: 7, isSeen: false }] })
      .mockResolvedValueOnce({
        messageData: {
          date: "2026-01-02T12:00:00Z",
          subject: "Receipt",
          messagePlainText: "A receipt",
          from: "shop@example.com",
        },
      });
    const page = await provider.getMessagesWithPagination({
      inboxOnly: true,
      maxResults: 1,
    });
    expect(page.messages[0].textPlain).toBe("A receipt");
    expect(page.messages[0].labelIds).toContain("UNREAD");
    expect(page.nextPageToken).toBe("1");
  });
  it("groups mutation UIDs by source folder and validates every ID before writing", async () => {
    const { provider, request } = fixtureProvider();
    request.mockResolvedValue({ success: true });
    await provider.markMessagesReadState(
      [smarterMailMessageId("Inbox", 7), smarterMailMessageId("Archive", 7)],
      true,
    );
    expect(request.mock.calls).toEqual([
      ["patchMessages", { folder: "Inbox", uid: [7], markRead: true }],
      ["patchMessages", { folder: "Archive", uid: [7], markRead: true }],
    ]);
    request.mockClear();
    await expect(
      provider.markMessagesReadState(
        [smarterMailMessageId("Inbox", 7), "bad-id"],
        true,
      ),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("rejects unsupported send and attachment paths before touching the mailbox", async () => {
    const { provider, request } = fixtureProvider();
    await expect(
      provider.sendEmail({
        to: "recipient@example.com",
        subject: "Fixture",
        messageText: "Fixture",
      }),
    ).rejects.toThrow("does not currently support");
    await expect(
      provider.getAttachment(smarterMailMessageId("Inbox", 1), "part-1"),
    ).rejects.toThrow("does not currently support");
    expect(request).not.toHaveBeenCalled();
  });
  it("hydrates conversation candidates once within the request budget and refuses incomplete strict history", async () => {
    const { provider, request } = fixtureProvider();
    let candidateCount = 20;
    request.mockImplementation(async (operation, body) => {
      if (operation === "search")
        return {
          results: Array.from({ length: candidateCount }, (_, index) => ({
            uid: index + 1,
            folder: "Inbox",
          })),
          totalCount: candidateCount,
        };
      if (operation === "message") {
        const uid = Number(body?.uid);
        const references =
          uid === 1
            ? ""
            : uid === 4
              ? "References: <m1@example.com> <m2@example.com> <m3@example.com>\r\n"
              : "References: <m1@example.com>\r\n";
        return {
          messageData: {
            date: "2026-01-01T00:00:00Z",
            header: `${references}Message-ID: <m${uid}@example.com>`,
          },
        };
      }
      throw new Error("Unexpected operation");
    });
    const anchor = smarterMailMessageId("Inbox", 4);
    expect(
      (await provider.getThread(anchor, { complete: true })).messages,
    ).toHaveLength(20);
    expect(request.mock.calls).toHaveLength(21);
    expect(
      request.mock.calls.filter(([operation]) => operation === "message"),
    ).toHaveLength(20);
    request.mockClear();
    candidateCount = 25;
    await expect(
      provider.getThread(anchor, { complete: true }),
    ).rejects.toThrow("complete conversations beyond");
    expect(request.mock.calls).toHaveLength(2);
    request.mockClear();
    candidateCount = 1;
    await expect(
      provider.getThread(anchor, { complete: true }),
    ).rejects.toThrow("unresolved referenced");
    expect((await provider.getThread(anchor)).messages).toHaveLength(2);
  });
});
