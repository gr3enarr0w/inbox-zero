import { describe, it, expect, vi } from "vitest";
import { SmarterMailProvider } from "@/utils/email/smartermail";
import { SmarterMailClient } from "@/utils/smartermail/client";
import { createScopedLogger } from "@/utils/logger";
import { smarterMailMessageId } from "@/utils/smartermail/message";
vi.mock("server-only", () => ({}));
vi.mock("@/utils/smartermail/watch", () => ({}));

describe("SmarterMail deletion verification", () => {
  it("only returns IDs confirmed to exist in the requested folder", async () => {
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com",
      tokens: { accessToken: "test", refreshToken: "test" },
    });
    const request = vi
      .spyOn(client, "request")
      .mockResolvedValue({ success: true, totalCount: 1, results: [7] });
    const provider = new SmarterMailProvider(
      client,
      createScopedLogger("smartermail-presence-test"),
      "fixture",
    );
    expect(
      await provider.hasMessagesInFolder("Inbox", [
        smarterMailMessageId("Inbox", 7),
        smarterMailMessageId("Inbox", 8),
      ]),
    ).toEqual([smarterMailMessageId("Inbox", 7)]);
    expect(request).toHaveBeenCalledWith(
      "messagesUid",
      expect.objectContaining({
        folder: "Inbox",
        selectedIds: [7, 8],
        take: 100,
      }),
    );
    request.mockResolvedValue({ success: true, totalCount: 2, results: [7] });
    await expect(
      provider.hasMessagesInFolder("Inbox", [smarterMailMessageId("Inbox", 7)]),
    ).rejects.toThrow("incomplete");
    request.mockResolvedValue({ success: true, totalCount: 1, results: [999] });
    await expect(
      provider.hasMessagesInFolder("Inbox", [smarterMailMessageId("Inbox", 7)]),
    ).rejects.toThrow("unscoped");
    request.mockResolvedValue({ success: true, totalCount: 0 });
    await expect(
      provider.hasMessagesInFolder("Inbox", [smarterMailMessageId("Inbox", 7)]),
    ).rejects.toThrow();
  });
});
