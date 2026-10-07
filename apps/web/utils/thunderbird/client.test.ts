import { afterEach, describe, expect, it, vi } from "vitest";
import { ThunderbirdClient } from "@/utils/thunderbird/client";
vi.mock("server-only", () => ({}));
afterEach(() => vi.unstubAllGlobals());
describe("Thunderbird broker client", () => {
  it("rejects a changed native mailbox despite unchanged account id", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      reply({
        accountId: "native",
        account: {
          id: "native",
          email: "other@example.com",
          ready: true,
          inboxFound: true,
        },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(client().readAccount()).rejects.toThrow("mailbox scope");
  });
  it("rejects a foreign result envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(reply({ accountId: "other", folders: [] })),
    );
    await expect(client().request("listFolders")).rejects.toThrow(
      "account scope",
    );
  });
  it("allows unbound enrollment identity but disallows unbound mail reads", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      reply({
        accountId: "native",
        account: {
          id: "native",
          email: "mail@example.com",
          ready: true,
          inboxFound: true,
        },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const unbound = new ThunderbirdClient({
      baseUrl: "http://127.0.0.1:8787",
      token: "x".repeat(32),
    });
    expect((await unbound.readAccount()).account.id).toBe("native");
    await expect(
      unbound.request("getMessage", { messageId: 1 }),
    ).rejects.toThrow("not bound");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("preserves stale pagination errors for safe sync restart", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "STALE_PAGE" }), {
          status: 400,
        }),
      ),
    );
    await expect(
      client().request("listMessages", {
        maxResults: 25,
        pageToken: "expired",
      }),
    ).rejects.toMatchObject({ code: "STALE_PAGE" });
  });
  it("never retries a write with an unknown transport outcome", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValue(new Error("Private failure content"));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      client().request("createFolder", { name: "Safe folder" }),
    ).rejects.toThrow("unknown");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["listFolders", "READ_FAILED"],
    ["createFolder", "WRITE_UNKNOWN"],
  ] as const)("classifies interrupted %s response streams safely", async (operation, code) => {
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          controller.error(new Error("Private stream failure"));
        },
      }),
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(
      client().request(
        operation,
        operation === "createFolder" ? { name: "folder" } : {},
      ),
    ).rejects.toMatchObject({ code });
  });
  it("keeps malformed HTTP error payloads terminal instead of availability failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "UNRECOGNIZED" }, { status: 503 }),
        ),
    );
    await expect(client().request("listFolders")).rejects.toThrow(
      "Invalid Thunderbird bridge error response",
    );
  });
  it("rejects invalid UTF-8 even when replacement decoding would produce valid JSON", async () => {
    const bytes = Buffer.concat([
      Buffer.from('{"result":{"accountId":"native","text":"'),
      Buffer.from([0xff]),
      Buffer.from('"}}'),
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes)));
    await expect(client().request("listFolders")).rejects.toThrow(
      "Invalid Thunderbird bridge JSON",
    );
  });
  it("enforces a response body size bound", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("x".repeat(1_048_577))),
    );
    await expect(client().request("listFolders")).rejects.toThrow("size limit");
  });
});
function client() {
  return new ThunderbirdClient({
    baseUrl: "http://127.0.0.1:8787",
    token: "x".repeat(32),
    accountId: "native",
    expectedEmail: "mail@example.com",
  });
}
function reply(result: unknown) {
  return Response.json({ result });
}
