import { afterEach, describe, expect, it, vi } from "vitest";
import { SmarterMailClient } from "./client";
import { SmarterMailApiError } from "./errors";
import {
  authenticatedClient,
  jsonResponse,
  mockFetch,
  tokens,
} from "./client.test-support";

afterEach(() => vi.unstubAllGlobals());

describe("SmarterMailClient", () => {
  it("stops after one refresh when the server keeps rejecting a read", async () => {
    const fetchMock = mockFetch(
      jsonResponse({}, 401),
      jsonResponse(tokens("new-access", "new-refresh")),
      jsonResponse({}, 401),
    );
    await expect(authenticatedClient().request("folders")).rejects.toThrow(
      "SmarterMail request failed (401)",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("shares refresh failure across concurrent expired requests", async () => {
    const fetchMock = mockFetch(jsonResponse({}, 401));
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com",
      tokens: { ...tokens(), expiresAt: 1 },
    });
    const results = await Promise.allSettled([
      client.request("folders"),
      client.request("folders"),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes an expired JWT before sending a mutation", async () => {
    const fetchMock = mockFetch(
      jsonResponse(tokens("expired-access", "refresh")),
      jsonResponse(tokens("new-access", "new-refresh")),
      jsonResponse({ success: true }),
    );
    const jwt = `header.${Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url")}.signature`;
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(jsonResponse(tokens(jwt, "refresh")));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(tokens("new-access", "new-refresh")),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com",
    });
    await client.authenticate({
      username: "user@example.com",
      password: "secret",
    });
    await client.request("sendMessage", { subject: "test" });
    expect(fetchMock.mock.calls[1][0]).toContain("auth/refresh-token");
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe(
      "Bearer new-access",
    );
  });

  it("does not send a request when rotated tokens cannot be persisted", async () => {
    const fetchMock = mockFetch(
      jsonResponse(tokens("new-access", "new-refresh")),
    );
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com",
      tokens: { ...tokens(), expiresAt: 1 },
      onTokensChanged: () => {
        throw new Error("storage unavailable");
      },
    });
    await expect(client.request("folders")).rejects.toThrow(
      "SmarterMail credentials could not be saved. Retry the request.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps credentials isolated between clients", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ folders: [] }),
      jsonResponse({ folders: [] }),
    );
    const first = authenticatedClient();
    const second = new SmarterMailClient({
      baseUrl: "https://other.example.com",
      tokens: tokens("second-access", "second-refresh"),
    });
    await Promise.all([first.request("folders"), second.request("folders")]);
    expect(
      fetchMock.mock.calls.map(([, init]) => init.headers.Authorization),
    ).toEqual(["Bearer access", "Bearer second-access"]);
  });

  it("rejects unknown operations before contacting the server", async () => {
    const fetchMock = mockFetch();
    // @ts-expect-error Untrusted runtime input must not bypass the endpoint allowlist.
    await expect(
      authenticatedClient().request("https://other.example.com"),
    ).rejects.toThrow("Unknown SmarterMail operation");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects redirects without following them or exposing server text", async () => {
    const fetchMock = mockFetch(
      new Response("private-token", {
        status: 302,
        headers: { Location: "https://other.example.com" },
      }),
    );
    await expect(authenticatedClient().request("folders")).rejects.toThrow(
      "SmarterMail request failed (302)",
    );
    expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
  });

  it.each([
    new Response("private-token", { status: 500 }),
    new Response("not-json"),
    jsonResponse({ success: false, message: "private-token" }),
  ])("does not expose raw server errors", async (response) => {
    mockFetch(response);
    await expect(authenticatedClient().request("folders")).rejects.toThrow(
      SmarterMailApiError,
    );
  });

  it("sanitizes network errors that may contain credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("private-password")),
    );
    await expect(authenticatedClient().request("folders")).rejects.toThrow(
      "SmarterMail server could not be reached",
    );
  });
});
