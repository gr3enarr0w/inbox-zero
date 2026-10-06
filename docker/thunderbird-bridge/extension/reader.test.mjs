import assert from "node:assert/strict";
import { test, mock } from "node:test";
import "./reader.js";

const { readCommand, errorCode } = globalThis.InboxZeroThunderbirdReader;
const accountId = "account1";
const folder = { id: "inbox1", accountId };
const base = { nonce: "0123456789abcdef", accountId };
function header(id = 1) {
  return { id, folder, headerMessageId: "fixture@example.com", subject: "Fixture", author: "sender@example.com", recipients: ["reader@example.com"], date: new Date("2026-10-01T00:00:00Z"), size: 10 };
}
function fixture() {
  return {
    accounts: { get: mock.fn(async () => ({ id: accountId, identities: [{ email: "private@example.com" }] })) },
    folders: { query: mock.fn(async () => [folder]) },
    messages: {
      get: mock.fn(async () => header()),
      getFull: mock.fn(async () => ({ contentType: "text/plain", body: "Fixture body" })),
      query: mock.fn(async () => ({ id: "pending-list", messages: [header(1), header(2), header(3)] })),
      abortList: mock.fn(async () => undefined),
    },
  };
}

test("account readiness returns no identity emails", async () => {
  const api = fixture();
  const result = await readCommand(api, { ...base, type: "readAccount" });
  assert.deepEqual(result, { accountId, account: { id: accountId, ready: true, inboxFound: true } });
  assert.equal(JSON.stringify(result).includes("private@example.com"), false);
  assert.equal(api.messages.getFull.mock.callCount(), 0);
});

test("cross-account message references are rejected before reading MIME data", async () => {
  const api = fixture();
  api.messages.get = mock.fn(async () => ({ ...header(), folder: { ...folder, accountId: "other" } }));
  await assert.rejects(readCommand(api, { ...base, type: "getMessage", messageId: 1 }), { message: "OUT_OF_SCOPE" });
  assert.equal(api.messages.getFull.mock.callCount(), 0);
});

test("inbox query is scoped, sliced and unfinished native lists are aborted", async () => {
  const api = fixture();
  const result = await readCommand(api, { ...base, type: "listInbox", maxResults: 2 });
  assert.deepEqual(api.messages.query.mock.calls[0].arguments, [{ folderId: folder.id, messagesPerPage: 2 }]);
  assert.deepEqual(result.messages.map((message) => message.id), [1, 2]);
  assert.deepEqual(api.messages.abortList.mock.calls[0].arguments, ["pending-list"]);
});

test("a foreign-folder inbox response still aborts the native list", async () => {
  const api = fixture();
  api.messages.query = mock.fn(async () => ({ id: "pending-list", messages: [{ ...header(), folder: { id: "other", accountId } }] }));
  await assert.rejects(readCommand(api, { ...base, type: "listInbox" }), { message: "OUT_OF_SCOPE" });
  assert.equal(api.messages.abortList.mock.callCount(), 1);
});

test("message reads preserve RFC identity, normalize bodies and omit attachments", async () => {
  const api = fixture();
  api.messages.getFull = mock.fn(async () => ({ contentType: "multipart/mixed", parts: [
    { contentType: "text/plain", body: "Plain" },
    { contentType: "text/html", body: "<p>HTML</p>" },
    { contentType: "text/plain", name: "attachment.txt", body: "attachment secret" },
    { contentType: "message/rfc822", parts: [{ contentType: "text/plain", body: "nested secret" }] },
  ] }));
  const { message } = await readCommand(api, { ...base, type: "getMessage", messageId: 1 });
  assert.equal(message.id, 1);
  assert.equal(message.headerMessageId, "fixture@example.com");
  assert.equal(message.textPlain, "Plain");
  assert.equal(message.textHtml, "<p>HTML</p>");
  assert.equal(JSON.stringify(message).includes("secret"), false);
});

test("oversized MIME data is rejected and errors cannot disclose private provider messages", async () => {
  const api = fixture();
  api.messages.getFull = mock.fn(async () => ({ contentType: "text/plain", body: "x".repeat(1024 * 1024) }));
  await assert.rejects(readCommand(api, { ...base, type: "getMessage", messageId: 1 }), { message: "TOO_LARGE" });
  api.accounts.get = mock.fn(async () => { throw new Error("private@example.com password=secret"); });
  await assert.rejects(readCommand(api, { ...base, type: "readAccount" }), { message: "READ_FAILED" });
  assert.equal(errorCode(new Error("OUT_OF_SCOPE private@example.com")), "READ_FAILED");
});

test("unknown operations and unbounded or extra arguments fail before native access", async () => {
  const api = fixture();
  for (const command of [{ ...base, type: "send" }, { ...base, type: "listInbox", maxResults: 26 }, { ...base, type: "readAccount", messageId: 1 }])
    await assert.rejects(readCommand(api, command), { message: "UNSUPPORTED" });
  assert.equal(api.accounts.get.mock.callCount(), 0);
});


test("near-limit payloads leave space for the authenticated result envelope", async () => {
  const api = fixture();
  const command = { ...base, nonce: "a".repeat(64), type: "getMessage", messageId: 1 };
  api.messages.getFull = mock.fn(async () => ({ contentType: "text/plain", body: "x".repeat(1024 * 1024 - 2048) }));
  const result = await readCommand(api, command);
  assert.ok(new TextEncoder().encode(JSON.stringify({ nonce: command.nonce, result })).byteLength < 1024 * 1024);
  api.messages.getFull = mock.fn(async () => ({ contentType: "text/plain", body: "x".repeat(1024 * 1024 - 512) }));
  await assert.rejects(readCommand(api, command), { message: "TOO_LARGE" });
});
