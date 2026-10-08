import { afterEach, describe, expect, it, vi } from "vitest";
import { SmarterMailMessageNotFoundError } from "./errors";
import {
  authenticatedClient,
  jsonResponse,
  mockFetch,
} from "./client.test-support";

afterEach(() => vi.unstubAllGlobals());

describe("SmarterMail missing message boundary", () => {
  it("recognizes only the verified missing-message response", async () => {
    mockFetch(
      jsonResponse(
        { success: false, message: "The message was not found." },
        400,
      ),
    );
    await expect(
      authenticatedClient().request("message", { folder: "Inbox", uid: 7 }),
    ).rejects.toBeInstanceOf(SmarterMailMessageNotFoundError);
  });
  it.each([
    { status: 500, success: false, message: "The message was not found." },
    { status: 400, success: true, message: "The message was not found." },
    {
      status: 400,
      success: false,
      message: "private credential or mailbox content",
    },
  ])("keeps ambiguous failures sanitized and distinct from absence", async ({
    status,
    success,
    message,
  }) => {
    mockFetch(jsonResponse({ success, message }, status));
    const error = await authenticatedClient()
      .request("message", { folder: "Inbox", uid: 7 })
      .catch((error) => error);
    expect(error).not.toBeInstanceOf(SmarterMailMessageNotFoundError);
    expect(error.message).toBe(`SmarterMail request failed (${status})`);
  });
  it("never treats errors from another endpoint as missing mail", async () => {
    mockFetch(
      jsonResponse(
        { success: false, message: "The message was not found." },
        400,
      ),
    );
    await expect(
      authenticatedClient().request("messages", { folder: "Inbox" }),
    ).rejects.not.toBeInstanceOf(SmarterMailMessageNotFoundError);
  });
});
