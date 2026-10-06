import test from "node:test";
import assert from "node:assert/strict";
import { createBridgeServer } from "./server.mjs";

const bridgeToken = "b".repeat(64), operatorToken = "o".repeat(64), accountId = "fixture-account";
test("health is minimal and credentials cannot cross role boundaries", async t => {
  const api = await fixture(t);
  assert.deepEqual(await (await api("/health")).json(), { ok: true, readOnlyStaging: true });
  assert.equal((await api("/operator/status")).status, 401);
  assert.equal((await api("/operator/status", undefined, bridgeToken)).status, 401);
  assert.equal((await api("/bridge/commands", undefined, operatorToken)).status, 401);
  const status = await (await api("/operator/status", undefined, operatorToken)).json();
  assert.deepEqual(status, { readOnlyStaging: true, accountBound: true, bridgeConnected: false, pending: false, completed: 0 });
});
test("only explicitly allowed reads and bounds can be queued", async t => {
  const api = await fixture(t);
  for (const command of [
    { type: "send" }, { type: "eval", source: "code" },
    { type: "listInbox", maxResults: 26 }, { type: "listInbox", maxResults: 0 },
    { type: "getMessage", messageId: -1 }, { type: "readAccount", accountId: "other" },
  ]) assert.equal((await api("/operator/commands", command, operatorToken)).status, 400);
});
test("nonce, fixed account and list size are enforced before delivery to the operator", async t => {
  const api = await fixture(t);
  const result = api("/operator/commands", { type: "listInbox", maxResults: 1 }, operatorToken);
  const command = await (await api("/bridge/commands", undefined, bridgeToken)).json();
  assert.equal(command.accountId, accountId);
  assert.equal(command.type, "listInbox");
  assert.equal(command.maxResults, 1);
  assert.match(command.nonce, /^[a-f0-9]{64}$/);
  assert.equal((await api("/bridge/results", { nonce: "stale", result: {} }, bridgeToken)).status, 409);
  assert.equal((await api("/bridge/results", { nonce: command.nonce, result: { accountId: "other", messages: [] } }, bridgeToken)).status, 400);
  assert.equal((await api("/bridge/results", { nonce: command.nonce, result: { accountId, messages: [{ id: 1 }, { id: 2 }] } }, bridgeToken)).status, 400);
  const value = { accountId, messages: [{ id: 1 }] };
  assert.equal((await api("/bridge/results", { nonce: command.nonce, result: value }, bridgeToken)).status, 200);
  assert.deepEqual(await (await result).json(), { result: value });
  assert.equal((await api("/bridge/results", { nonce: command.nonce, result: value }, bridgeToken)).status, 409);
});
test("account and message reads validate the returned identity", async t => {
  const api = await fixture(t);
  for (const [input, value] of [
    [{ type: "readAccount" }, { accountId, account: { id: accountId, ready: true, inboxFound: true } }],
    [{ type: "getMessage", messageId: 7 }, { accountId, message: { id: 7, textPlain: "Fixture" } }],
  ]) {
    const result = api("/operator/commands", input, operatorToken);
    const command = await (await api("/bridge/commands", undefined, bridgeToken)).json();
    const wrong = input.type === "getMessage" ? { accountId, message: { id: 8 } } : { accountId, account: { id: "other" } };
    assert.equal((await api("/bridge/results", { nonce: command.nonce, result: wrong }, bridgeToken)).status, 400);
    await api("/bridge/results", { nonce: command.nonce, result: value }, bridgeToken);
    assert.deepEqual(await (await result).json(), { result: value });
  }
});
test("one pending command expires and bridge errors cannot disclose arbitrary text", async t => {
  const api = await fixture(t, { commandMs: 250 });
  const first = api("/operator/commands", { type: "readAccount" }, operatorToken);
  const command = await (await api("/bridge/commands", undefined, bridgeToken)).json();
  assert.equal((await api("/operator/commands", { type: "readAccount" }, operatorToken)).status, 409);
  assert.equal((await api("/bridge/results", { nonce: command.nonce, error: "private content" }, bridgeToken)).status, 400);
  assert.equal((await first).status, 504);
  const second = api("/operator/commands", { type: "readAccount" }, operatorToken);
  const next = await (await api("/bridge/commands", undefined, bridgeToken)).json();
  await api("/bridge/results", { nonce: next.nonce, error: "READ_FAILED" }, bridgeToken);
  assert.deepEqual(await (await second).json(), { error: "READ_FAILED" });
});
test("idle polls and oversized requests finish within their bounds", async t => {
  const api = await fixture(t, { pollMs: 20, bodyLimit: 256 });
  assert.equal((await api("/bridge/commands", undefined, bridgeToken)).status, 204);
  assert.equal((await api("/operator/commands", { type: "readAccount", extra: "x".repeat(512) }, operatorToken)).status, 413);
});

async function fixture(t, options = {}) {
  const server = createBridgeServer({ bridgeToken, operatorToken, accountId, commandMs: 1000, ...options });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return (path, body, token) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(2000),
  });
}
