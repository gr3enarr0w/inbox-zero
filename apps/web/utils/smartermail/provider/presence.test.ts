import { describe, it, expect, vi } from "vitest";
import { SmarterMailProvider } from "@/utils/email/smartermail";
import { SmarterMailClient } from "@/utils/smartermail/client";
import {
  SmarterMailApiError,
  SmarterMailMessageNotFoundError,
} from "@/utils/smartermail/errors";
import { createScopedLogger } from "@/utils/logger";
import { smarterMailMessageId } from "@/utils/smartermail/message";
vi.mock("server-only", () => ({}));
vi.mock("@/utils/smartermail/watch", () => ({}));

describe("SmarterMail deletion verification", () => {
  it("confirms scoped identities and omits only verified missing messages", async () => {
    const { provider, request } = fixture();
    request.mockImplementation(async (_operation, body) => {
      if (body?.uid === 8) throw new SmarterMailMessageNotFoundError();
      return { success: true, messageData: { uid: 7, folder: "Inbox" } };
    });
    const present = smarterMailMessageId("Inbox", 7);
    const missing = smarterMailMessageId("Inbox", 8);
    expect(
      await provider.hasMessagesInFolder("Inbox", [present, present, missing]),
    ).toEqual([present]);
    expect(request.mock.calls).toEqual([
      ["message", { folder: "Inbox", uid: 7 }],
      ["message", { folder: "Inbox", uid: 8 }],
    ]);
    expect(await provider.hasMessagesInFolder("Inbox", [missing])).toEqual([]);
  });
  it.each([
    { uid: 9, folder: "Inbox" },
    { uid: 7, folder: "Archive" },
    { uid: 7 },
    { folder: "Inbox" },
  ])("rejects responses without the exact required UID and folder", async (messageData) => {
    const { provider, request } = fixture();
    request.mockResolvedValue({ success: true, messageData });
    await expect(
      provider.hasMessagesInFolder("Inbox", [smarterMailMessageId("Inbox", 7)]),
    ).rejects.toThrow();
  });
  it.each([
    400, 500,
  ])("preserves ambiguous HTTP failures rather than reporting absence", async (status) => {
    const { provider, request } = fixture();
    const error = new SmarterMailApiError("SmarterMail request failed", status);
    request.mockRejectedValue(error);
    await expect(
      provider.hasMessagesInFolder("Inbox", [smarterMailMessageId("Inbox", 7)]),
    ).rejects.toBe(error);
  });
  it("rejects oversized or cross-folder requests before IO", async () => {
    const { provider, request } = fixture();
    await expect(
      provider.hasMessagesInFolder(
        "Inbox",
        Array.from({ length: 26 }, (_, index) =>
          smarterMailMessageId("Inbox", index + 1),
        ),
      ),
    ).rejects.toThrow("25");
    await expect(
      provider.hasMessagesInFolder("Inbox", [
        smarterMailMessageId("Archive", 7),
      ]),
    ).rejects.toThrow("scope");
    expect(request).not.toHaveBeenCalled();
  });
});

function fixture() {
  const client = new SmarterMailClient({
    baseUrl: "https://mail.example.com",
    tokens: { accessToken: "test", refreshToken: "test" },
  });
  return {
    provider: new SmarterMailProvider(
      client,
      createScopedLogger("smartermail-presence-test"),
      "fixture",
    ),
    request: vi.spyOn(client, "request"),
  };
}
