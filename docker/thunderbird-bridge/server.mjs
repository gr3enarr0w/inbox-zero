import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import "./extension/protocol.js";
const { errors, validate } = globalThis.InboxZeroThunderbirdProtocol;
export function createBridgeServer({ bridgeToken, operatorToken, accountId, pollMs = 25_000, commandMs = 30_000, bodyLimit = 1_048_576 }) {
  if (![bridgeToken, operatorToken].every(value => typeof value === "string" && /^[A-Za-z0-9_-]{32,256}$/.test(value)) || bridgeToken === operatorToken)
    throw new Error("Distinct valid bridge and operator secrets are required");
  if (typeof accountId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) throw new Error("A fixed Thunderbird account is required");
  if (!Number.isInteger(pollMs) || pollMs < 1 || pollMs > 25_000 || !Number.isInteger(commandMs) || commandMs < 1 || commandMs > 30_000 || !Number.isInteger(bodyLimit) || bodyLimit < 1 || bodyLimit > 1_048_576) throw new Error("Invalid bounded broker limits");
  let pending, poll, lastPoll = 0, completed = 0;
  const queue = [];
  const bridgeAuth = digest(`Bearer ${bridgeToken}`), operatorAuth = digest(`Bearer ${operatorToken}`);
  const send = (response, status, value) => { if (!response.writableEnded && !response.destroyed) { response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(value === undefined ? undefined : JSON.stringify(value)); } };
  function clearPoll() { if (poll) { clearTimeout(poll.timer); poll = undefined; } }
  function finish(status, value) {
    if (pending) { const job = pending; pending = undefined; clearTimeout(job.timer); send(job.response,status,value); }
    pending = queue.shift();
    deliver();
  }
  function deliver() { if (pending && !pending.delivered && poll) { const response = poll.response; clearPoll(); pending.delivered = true; send(response, 200, { nonce: pending.nonce, ...pending.command }); } }
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (url.search) throw failure(400);
      if (request.method === "GET" && url.pathname === "/health") return send(response, 200, { ok: true, readOnlyStaging: false });
      const bridge = url.pathname.startsWith("/bridge/");
      const authorization = request.headers.authorization;
      if (typeof authorization !== "string" || authorization.length > 512 || !timingSafeEqual(digest(authorization), bridge ? bridgeAuth : operatorAuth)) throw failure(401);
      if (request.method === "GET" && url.pathname === "/operator/status") return send(response, 200, { readOnlyStaging: false, accountBound: true, bridgeConnected: Date.now() - lastPoll < 60_000, pending: Boolean(pending), completed });
      if (request.method === "GET" && url.pathname === "/bridge/commands") {
        if (poll) throw failure(409);
        lastPoll = Date.now();
        poll = { response, timer: setTimeout(() => { clearPoll(); send(response, 204); }, pollMs) };
        response.on("close", () => { if (poll?.response === response) clearPoll(); });
        deliver();
        return;
      }
      if (request.method === "POST" && url.pathname === "/operator/commands") {
        if (queue.length >= 4) throw failure(409);
        const input = await readJson(request, bodyLimit);
        const command = validateCommand(input, accountId);
        if (queue.length >= 4) throw failure(409);
        const job = {response,command,nonce:randomBytes(32).toString("hex"),delivered:false};
        const expire = status => {
          if (pending === job) finish(status,{error:"TIMEOUT"});
          else { const index = queue.indexOf(job); if(index !== -1) { queue.splice(index,1); clearTimeout(job.timer); send(response,status,{error:"TIMEOUT"}); } }
        };
        job.timer = setTimeout(() => expire(504),commandMs);
        response.on("close",() => expire(499));
        if (pending) queue.push(job); else pending = job;
        deliver();
        return;
      }
      if (request.method === "POST" && url.pathname === "/bridge/results") {
        const input = await readJson(request, bodyLimit);
        if (!pending?.delivered || input?.nonce !== pending.nonce) throw failure(409);
        if (input.error !== undefined) {
          if (Object.keys(input).some(key => !["nonce", "error"].includes(key)) || !errors.has(input.error)) throw failure(400);
          finish(502, { error: input.error });
        } else {
          if (Object.keys(input).some(key => !["nonce", "result"].includes(key))) throw failure(400);
          validateResult(input.result, pending.command);
          if (Buffer.byteLength(JSON.stringify({ result: input.result })) > bodyLimit) throw failure(413);
          completed++;
          finish(200, { result: input.result });
        }
        return send(response, 200, { accepted: true });
      }
      throw failure(404);
    } catch (error) { response.setHeader("Connection", "close"); send(response, error.status ?? 400, { error: error.status === 413 ? "TOO_LARGE" : "REQUEST_REJECTED" }); }
  });
  server.maxConnections = 12;
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5000;
  server.on("close", () => { clearPoll(); while(pending) finish(503,{error:"STOPPED"}); });
  return server;
}
function digest(value) { return createHash("sha256").update(value).digest(); }
function failure(status) { return Object.assign(new Error("Request rejected"), { status }); }
function validateCommand(input, accountId) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw failure(400);
  if (input.accountId !== undefined || input.nonce !== undefined) throw failure(400);
  try { return validate(input, accountId); } catch { throw failure(400); }
}
function validateResult(result, command) {
  if (!result || typeof result !== "object" || Array.isArray(result) || result.accountId !== command.accountId) throw failure(400);
  if (command.type === "readAccount" && result.account?.id !== command.accountId) throw failure(400);
  if (["listInbox", "listMessages"].includes(command.type) && (!Array.isArray(result.messages) || result.messages.length > (command.maxResults ?? 25))) throw failure(400);
  if (command.type === "getMessage") {
    if (!Number.isSafeInteger(result.message?.id) || result.message.id < 1) throw failure(400);
    if (!command.identity && result.message.id !== command.messageId) throw failure(400);
    if (command.identity && Object.entries(command.identity).some(([key,value]) => result.message[key] !== value)) throw failure(400);
  }
}
function readJson(request, limit) {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw failure(415);
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, rejected = false;
    request.on("data", chunk => { size += chunk.length; if (size > limit) { if (!rejected) { rejected = true; request.pause(); reject(failure(413)); } } else chunks.push(chunk); });
    request.on("end", () => { if (!rejected) { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(failure(400)); } } });
    request.on("error", () => reject(failure(400)));
    request.on("aborted", () => reject(failure(400)));
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const readSecret = name => { if (!process.env[name]) throw new Error("Secret file configuration is required"); return readFileSync(process.env[name], "utf8").trim(); };
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: This standalone companion is not a Turborepo task.
  const server = createBridgeServer({ bridgeToken: readSecret("BRIDGE_TOKEN_FILE"), operatorToken: readSecret("OPERATOR_TOKEN_FILE"), accountId: process.env.THUNDERBIRD_ACCOUNT_ID });
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: This standalone companion is not a Turborepo task.
  server.listen(8787, process.env.BRIDGE_BIND_ADDRESS ?? "127.0.0.1");
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { server.closeAllConnections(); server.close(); });
}
