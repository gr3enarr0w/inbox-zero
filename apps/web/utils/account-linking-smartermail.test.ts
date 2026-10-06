import { afterEach, describe, expect, it, vi } from "vitest";
import { getAccountLinkingUrl } from "./account-linking";

afterEach(() => vi.unstubAllGlobals());

describe("SmarterMail account reconnection", () => {
  it("routes to account settings without starting Google OAuth", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      getAccountLinkingUrl("smartermail", {
        reconnectEmailAccountId: "mailbox",
      }),
    ).resolves.toBe("/accounts");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
