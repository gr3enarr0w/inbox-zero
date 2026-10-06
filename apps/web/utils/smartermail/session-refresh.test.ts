import { afterEach, describe, expect, it, vi } from "vitest";
import { SmarterMailClient } from "./client";
import { jsonResponse, tokens } from "./client.test-support";

afterEach(() => vi.unstubAllGlobals());

describe("SmarterMail identity during refresh", () => {
  it("blocks reauthentication until rotated credentials are saved and the read completes", async () => {
    let finishRefresh: (response: Response) => void = () => {
      throw new Error("refresh not started");
    };
    let notifyRefresh: () => void = () => {};
    const refreshStarted = new Promise<void>((resolve) => {
      notifyRefresh = resolve;
    });
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("auth/refresh-token")) {
        notifyRefresh();
        return new Promise<Response>((resolve) => {
          finishRefresh = resolve;
        });
      }
      return Promise.resolve(jsonResponse({ folders: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const persist = vi.fn();
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com",
      tokens: { ...tokens(), expiresAt: 1 },
      onTokensChanged: persist,
    });
    const pending = client.request("folders");
    await refreshStarted;
    await expect(
      client.authenticate({
        username: "other@example.com",
        password: "private-password",
      }),
    ).rejects.toThrow("client is busy");
    finishRefresh(jsonResponse(tokens("rotated-access", "rotated-refresh")));
    await expect(pending).resolves.toEqual({ folders: [] });
    expect(persist).toHaveBeenCalledWith({
      accessToken: "rotated-access",
      refreshToken: "rotated-refresh",
      expiresAt: undefined,
    });
    expect(
      fetchMock.mock.calls.map(([url]) => url.split("/api/v1/")[1]),
    ).toEqual(["auth/refresh-token", "folders/list-email-folders"]);
  });
});
