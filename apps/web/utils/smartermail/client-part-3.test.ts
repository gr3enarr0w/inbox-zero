import { afterEach, describe, expect, it, vi } from "vitest";
import { SmarterMailClient } from "./client";
import { SmarterMailMfaRequiredError } from "./errors";
import {
  authenticatedClient,
  jsonResponse,
  mockFetch,
  tokens,
} from "./client.test-support";

afterEach(() => vi.unstubAllGlobals());

describe("SmarterMailClient", () => {
  it("aborts requests that exceed the configured timeout", async () => {
    const mock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(new Error("private-token")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", mock);
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com",
      tokens: tokens(),
      timeoutMs: 5,
    });
    await expect(client.request("folders")).rejects.toThrow(
      "SmarterMail request timed out",
    );
  });

  it("does not serialize credentials or MFA challenges", async () => {
    mockFetch(
      jsonResponse({
        message: "TWO_FACTOR_REQUIRED",
        accessToken: "challenge-secret",
      }),
    );
    const client = authenticatedClient();
    expect(JSON.stringify(client)).toBe('{"type":"SmarterMailClient"}');
    await expect(
      client.authenticate({ username: "user@example.com", password: "secret" }),
    ).rejects.toBeInstanceOf(SmarterMailMfaRequiredError);
    expect(JSON.stringify(client)).toBe('{"type":"SmarterMailClient"}');
  });

  it("rejects malformed authentication responses", async () => {
    mockFetch(jsonResponse({ accessToken: "access" }));
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com",
    });
    await expect(
      client.authenticate({ username: "user@example.com", password: "secret" }),
    ).rejects.toThrow("Invalid SmarterMail authentication response");
    await expect(client.request("folders")).rejects.toThrow(
      "not authenticated",
    );
  });
});
