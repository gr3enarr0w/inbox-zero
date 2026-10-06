import { afterEach, describe, expect, it, vi } from "vitest";
import { inspect } from "node:util";
import { SmarterMailClient } from "./client";
import {
  authenticatedClient,
  jsonResponse,
  mockFetch,
  tokens,
} from "./client.test-support";

afterEach(() => vi.unstubAllGlobals());

describe("SmarterMail session state", () => {
  it("keeps tokens and MFA credentials out of runtime object inspection", async () => {
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com",
      tokens: tokens("private-access", "private-refresh"),
    });
    expect(inspect(client)).not.toContain("private-access");
    expect(inspect(client)).not.toContain("private-refresh");
    mockFetch(
      jsonResponse({
        message: "TWO_FACTOR_REQUIRED",
        accessToken: "private-challenge",
      }),
    );
    await expect(
      client.authenticate({
        username: "user@example.com",
        password: "private-password",
      }),
    ).rejects.toThrow();
    expect(inspect(client)).not.toContain("private-challenge");
    expect(JSON.stringify({ ...client })).not.toContain("private-challenge");
  });

  it("rejects identity replacement until a mailbox request finishes", async () => {
    let finish: (response: Response) => void = () => {
      throw new Error("request not started");
    };
    const fetchMock = vi.fn(
      (_url: string, _init: { headers: Record<string, string> }) =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = authenticatedClient();
    const pending = client.request("folders");
    await expect(
      client.authenticate({ username: "other@example.com", password: "other" }),
    ).rejects.toThrow("client is busy");
    finish(jsonResponse({ folders: [] }));
    await expect(pending).resolves.toEqual({ folders: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer access",
    );
    mockFetch(
      jsonResponse(tokens("other-access", "other-refresh")),
      jsonResponse({ folders: [] }),
    );
    await client.authenticate({
      username: "other@example.com",
      password: "other",
    });
    await expect(client.request("folders")).resolves.toEqual({ folders: [] });
  });

  it("rejects mailbox reads and a second login while authentication is pending", async () => {
    let finish: (response: Response) => void = () => {
      throw new Error("authentication not started");
    };
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = authenticatedClient();
    const pending = client.authenticate({
      username: "user@example.com",
      password: "password",
    });
    await expect(client.request("folders")).rejects.toThrow(
      "authentication is in progress",
    );
    await expect(
      client.authenticate({ username: "other@example.com", password: "other" }),
    ).rejects.toThrow("client is busy");
    finish(jsonResponse(tokens("new-access", "new-refresh")));
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("redacts credential persistence errors and releases authentication on failure", async () => {
    mockFetch(
      jsonResponse(tokens("new-access", "new-refresh")),
      jsonResponse({ folders: [] }),
    );
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com",
      onTokensChanged: () => {
        throw new Error("private-access private-password");
      },
    });
    await expect(
      client.authenticate({
        username: "user@example.com",
        password: "password",
      }),
    ).rejects.toThrow("credentials could not be saved");
    await expect(client.request("folders")).rejects.toThrow(
      "not authenticated",
    );
  });
});
