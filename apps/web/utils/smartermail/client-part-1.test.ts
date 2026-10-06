import { afterEach, describe, expect, it, vi } from "vitest";
import { SmarterMailClient } from "./client";
import { SmarterMailApiError, SmarterMailMfaRequiredError } from "./errors";
import {
  authenticatedClient,
  jsonResponse,
  mockFetch,
  tokens,
} from "./client.test-support";

afterEach(() => vi.unstubAllGlobals());

describe("SmarterMailClient", () => {
  it.each([
    "http://mail.example.com",
    "https://user:password@mail.example.com",
    "https://mail.example.com/?token=secret",
    "https://mail.example.com/#secret",
  ])("rejects unsafe server URL %s before making a request", (baseUrl) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(() => new SmarterMailClient({ baseUrl })).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("persists authenticated tokens before making them available", async () => {
    const fetchMock = mockFetch(jsonResponse(tokens()));
    const saved: unknown[] = [];
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com/webmail/",
      onTokensChanged: (value) => {
        saved.push(value);
      },
    });
    await client.authenticate({
      username: "user@example.com",
      password: "secret",
    });
    expect(saved).toEqual([expect.objectContaining(tokens())]);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://mail.example.com/webmail/api/v1/auth/authenticate-user",
    );
  });

  it("requires explicit MFA completion and never retries an invalid code", async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        success: false,
        message: "TWO_FACTOR_REQUIRED",
        accessToken: "challenge-secret",
      }),
      jsonResponse({ message: "invalid code, challenge-secret" }, 401),
    );
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com",
    });
    await expect(
      client.authenticate({ username: "user@example.com", password: "secret" }),
    ).rejects.toBeInstanceOf(SmarterMailMfaRequiredError);
    await expect(client.request("folders")).rejects.toThrow(
      "not authenticated",
    );
    await expect(client.completeMfa("123456")).rejects.toThrow(
      "SmarterMail request failed (401)",
    );
    await expect(client.completeMfa("123456")).rejects.toThrow("No pending");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the MFA challenge only to complete authentication", async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        message: "TWO_FACTOR_REQUIRED",
        accessToken: "challenge",
      }),
      jsonResponse(tokens()),
      jsonResponse({ folders: [] }),
    );
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com",
    });
    await expect(
      client.authenticate({ username: "user@example.com", password: "secret" }),
    ).rejects.toBeInstanceOf(SmarterMailMfaRequiredError);
    await client.completeMfa("123456");
    await client.request("folders");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
      "Bearer challenge",
    );
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe(
      "Bearer access",
    );
  });

  it("refreshes once for concurrent requests with expired tokens", async () => {
    const fetchMock = mockFetch(
      jsonResponse(tokens("new-access", "new-refresh")),
      jsonResponse({ folders: [] }),
      jsonResponse({ folders: [] }),
    );
    const onTokensChanged = vi.fn();
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com",
      tokens: { ...tokens(), expiresAt: Date.now() - 1000 },
      onTokensChanged,
    });
    await Promise.all([client.request("folders"), client.request("folders")]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.filter(([url]) => url.endsWith("refresh-token")),
    ).toHaveLength(1);
    expect(onTokensChanged).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls
        .slice(1)
        .map(([, init]) => init.headers.Authorization),
    ).toEqual(["Bearer new-access", "Bearer new-access"]);
  });

  it("retries a read-only POST once after a token expires", async () => {
    const fetchMock = mockFetch(
      jsonResponse({}, 401),
      jsonResponse(tokens("new-access", "new-refresh")),
      jsonResponse({ messages: [] }),
    );
    const client = authenticatedClient();
    await expect(
      client.request("messages", { folder: "INBOX" }),
    ).resolves.toEqual({ messages: [] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe(
      "Bearer new-access",
    );
  });

  it("does not automatically replay a mail mutation", async () => {
    const fetchMock = mockFetch(jsonResponse({}, 401));
    await expect(
      authenticatedClient().request("sendMessage", { subject: "test" }),
    ).rejects.toBeInstanceOf(SmarterMailApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
