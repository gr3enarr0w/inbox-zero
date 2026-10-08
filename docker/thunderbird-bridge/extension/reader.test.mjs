import assert from "node:assert/strict";
import { test, mock } from "node:test";
import "./protocol.js";
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

test("account readiness returns scoped enrollment identity", async () => {
  const api = fixture();
  const result = await readCommand(api, { ...base, type: "readAccount" });
  assert.deepEqual(result, { accountId, account: { id: accountId, email: "private@example.com", ready: true, inboxFound: true } });
  assert.equal(result.account.email, "private@example.com");
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


test("native RFC message wrappers expose the main body without importing attached messages", async () => {
  const api = fixture();
  api.messages.getFull = mock.fn(async () => ({ contentType: "message/rfc822", parts: [
    { contentType: "text/plain", body: "Primary message" },
    { contentType: "message/rfc822", parts: [{ contentType: "text/plain", body: "Attached message" }] },
  ] }));
  const result = await readCommand(api, { ...base, type: "getMessage", messageId: 1 });
  assert.equal(result.message.textPlain, "Primary message");
});

test("recycled native IDs cannot modify another message and foreign destinations are rejected", async () => {
  const api = fixture();
  api.messages.move = mock.fn(async () => undefined);
  api.folders.get = mock.fn(async () => ({id:'foreign',accountId:'other'}));
  const identity = {headerMessageId:header().headerMessageId,date:header().date.toISOString(),subject:header().subject};
  await assert.rejects(readCommand(api,{...base,type:'moveMessage',operationId:'0123456789abcdef',messageId:1,identity,destinationFolderId:'foreign'}),{message:'OUT_OF_SCOPE'});
  assert.equal(api.messages.move.mock.callCount(),0);
  api.messages.get = mock.fn(async () => ({...header(),headerMessageId:'different'}));
  await assert.rejects(readCommand(api,{...base,type:'moveMessage',operationId:'0123456789abcdef',messageId:1,identity,destinationFolderId:'foreign'}),{message:'MESSAGE_NOT_FOUND'});
  assert.equal(api.messages.move.mock.callCount(),0);
});

test("pagination tokens are bound to the exact account, folder and query", async () => {
  const api = fixture();
  api.folders.get = mock.fn(async () => folder);
  api.messages.continueList = mock.fn(async () => ({messages:[header(2)]}));
  api.messages.query = mock.fn(async () => ({id:'native-page',messages:[header()]}));
  const first = await readCommand(api,{...base,type:'listMessages',folderId:folder.id,maxResults:1});
  await assert.rejects(readCommand(api,{...base,type:'listMessages',folderId:folder.id,maxResults:1,query:{read:true},pageToken:first.nextPageToken}),{message:'STALE_PAGE'});
  assert.equal(api.messages.continueList.mock.callCount(),0);
  const next = await readCommand(api,{...base,type:'listMessages',folderId:folder.id,maxResults:1,pageToken:first.nextPageToken});
  assert.equal(next.messages[0].id,2);
  await assert.rejects(readCommand(api,{...base,type:'listMessages',folderId:folder.id,maxResults:1,pageToken:first.nextPageToken}),{message:'STALE_PAGE'});
});

test('draft saving requires explicit account and identity enrollment before composing', async () => {
  const api = fixture();
  api.accounts.get = mock.fn(async () => ({id: accountId, identities: [{id: 'identity1',email:'reader@example.com'}]}));
  api.compose = {beginNew: mock.fn(async () => ({id: 1}))};
  const command = {...base,type:'createDraft',operationId:'0123456789abcdef',to:['recipient@example.com'],subject:'Draft',textPlain:'Body'};
  for (const options of [{},{draftsAccountId:'other',draftsIdentityId:'identity1'},{draftsAccountId:accountId,draftsIdentityId:'foreign'}])
    await assert.rejects(readCommand(api,command,options),{message:'OUT_OF_SCOPE'});
  assert.equal(api.compose.beginNew.mock.callCount(),0);
});

test('enrolled draft saving preflights owned Drafts and clears FCC copies', async () => {
  const api = fixture();
  const drafts = {id:'drafts1',accountId};
  api.accounts.get = mock.fn(async () => ({id:accountId,identities:[{id:'identity1'}]}));
  api.folders.query = mock.fn(async () => [drafts]);
  api.compose = {
    beginNew: mock.fn(async () => ({id:7})),
    saveMessage: mock.fn(async () => ({messages:[{...header(),folder:drafts}]})),
  };
  api.tabs = {remove: mock.fn(async () => undefined)};
  const command = {...base,type:'createDraft',operationId:'0123456789abcdef',to:['recipient@example.com'],subject:'Draft',textPlain:'Body'};
  const options = {draftsAccountId:accountId,draftsIdentityId:'identity1'};
  const result = await readCommand(api,command,options);
  assert.equal(result.message.folderId,'drafts1');
  assert.deepEqual(api.folders.query.mock.calls[0].arguments,[{accountId,specialUse:['drafts']}]);
  assert.deepEqual(api.compose.beginNew.mock.calls[0].arguments,[{
    identityId:'identity1',to:command.to,subject:'Draft',plainTextBody:'Body',isPlainText:true,
    overrideDefaultFcc:true,overrideDefaultFccFolder:'',additionalFccFolder:'',
  }]);
  assert.equal(api.tabs.remove.mock.callCount(),1);
  api.compose.saveMessage = mock.fn(async () => ({messages:[{...header(),folder:drafts},{...header(2),folder:{id:'other',accountId:'foreign'}}]}));
  await assert.rejects(readCommand(api,command,options),{message:'OUT_OF_SCOPE'});
});

test('drafts fail before native composition if the owned server Drafts folder is missing', async () => {
  const api = fixture();
  api.accounts.get = mock.fn(async () => ({id:accountId,identities:[{id:'identity1'}]}));
  api.folders.query = mock.fn(async () => []);
  api.compose = {beginNew:mock.fn(async () => ({id:1}))};
  const command = {...base,type:'createDraft',operationId:'0123456789abcdef',to:['recipient@example.com'],subject:'Draft',textPlain:'Body'};
  await assert.rejects(readCommand(api,command,{draftsAccountId:accountId,draftsIdentityId:'identity1'}),{message:'OUT_OF_SCOPE'});
  assert.equal(api.compose.beginNew.mock.callCount(),0);
});

test('stale native identities wait for a bounded query to finish before establishing uniqueness', async () => {
  const api = fixture();
  api.messages.get = mock.fn(async () => {throw new Error('expired numeric ID');});
  api.messages.query = mock.fn(async () => ({id:'pending-rfc-query',messages:[]}));
  api.messages.continueList = mock.fn(async () => ({messages:[header(42)]}));
  const identity = {headerMessageId:header().headerMessageId,date:header().date.toISOString(),subject:header().subject};
  const result = await readCommand(api,{...base,type:'getMessage',messageId:1,identity});
  assert.equal(result.message.id,42);
  assert.equal(api.messages.continueList.mock.callCount(),1);
});

test('move receipts use scoped onMoved headers when the destination index is not ready', async () => {
  const api = fixture();
  const destination = {id:'archive1',accountId};
  const listeners = new Set();
  api.messages.onMoved = {addListener:listener=>listeners.add(listener),removeListener:listener=>listeners.delete(listener)};
  api.folders.get = mock.fn(async () => destination);
  api.messages.move = mock.fn(async () => {
    assert.equal(listeners.size,1);
    api.messages.get = mock.fn(async () => {throw new Error('Expired ID');});
    for (const listener of listeners) {
      listener({messages:[header()]},{messages:[{...header(9),folder:{id:'foreign',accountId:'other'}}]});
      listener({messages:[header(2)]},{messages:[{...header(9),folder:destination}]});
      setTimeout(() => listener({messages:[header()]},{messages:[{...header(9),folder:destination}]}),1);
    }
  });
  const identity = {headerMessageId:header().headerMessageId,date:header().date.toISOString(),subject:header().subject};
  const result = await readCommand(api,{...base,type:'moveMessage',operationId:'0123456789abcdef',messageId:1,identity,destinationFolderId:destination.id});
  assert.equal(result.message.id,9);
  assert.equal(result.message.folderId,destination.id);
  assert.equal(api.messages.query.mock.callCount(),0);
  assert.equal(api.messages.move.mock.callCount(),1);
  assert.equal(listeners.size,0);
});

test('native move failure removes its receipt listener without replaying the write', async () => {
  const api = fixture();
  const listeners = new Set();
  api.messages.onMoved = {addListener:listener=>listeners.add(listener),removeListener:listener=>listeners.delete(listener)};
  api.folders.get = mock.fn(async () => ({id:'archive1',accountId}));
  api.messages.move = mock.fn(async () => {throw new Error('Private provider failure');});
  const identity = {headerMessageId:header().headerMessageId,date:header().date.toISOString(),subject:header().subject};
  await assert.rejects(readCommand(api,{...base,type:'moveMessage',operationId:'0123456789abcdef',messageId:1,identity,destinationFolderId:'archive1'}),{message:'READ_FAILED'});
  assert.equal(listeners.size,0);
  assert.equal(api.messages.move.mock.callCount(),1);
});
