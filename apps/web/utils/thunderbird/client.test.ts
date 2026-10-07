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
  it.each([
    "missing",
    "oversize",
    "json",
    "utf8",
    "schema",
    "scope",
    "error",
  ])("preserves unknown write outcomes for %s responses without retrying", async (kind) => {
    let response: Response;
    if (kind === "missing") response = new Response(null);
    else if (kind === "oversize")
      response = new Response("x".repeat(1_048_577));
    else if (kind === "json") response = new Response("{");
    else if (kind === "utf8") response = new Response(new Uint8Array([0xff]));
    else if (kind === "scope") response = reply({ accountId: "other" });
    else if (kind === "error")
      response = Response.json({ error: "UNRECOGNIZED" }, { status: 503 });
    else response = reply({ accountId: "native" });
    const fetcher = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetcher);
    await expect(
      client().request("createFolder", { name: "folder" }),
    ).rejects.toMatchObject({ code: "WRITE_UNKNOWN" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("preserves a recognized broker rejection for a write", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "OUT_OF_SCOPE" }, { status: 403 }),
        ),
    );
    await expect(
      client().request("createFolder", { name: "folder" }),
    ).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
  });
  it("keeps local invalid commands outside unknown write handling", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      client().request("createFolder", { name: "bad/name" }),
    ).rejects.not.toMatchObject({ code: "WRITE_UNKNOWN" });
    expect(fetcher).not.toHaveBeenCalled();
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
