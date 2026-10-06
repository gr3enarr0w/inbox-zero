

(() => {
  const codes = new Set(["ACCOUNT_NOT_FOUND", "MESSAGE_NOT_FOUND", "OUT_OF_SCOPE", "READ_FAILED", "UNSUPPORTED", "TOO_LARGE"]);
  const maximumBytes = 1024 * 1024 - 1024;
  class ReaderError extends Error {
    constructor(code) { super(code); this.code = code; }
  }
  function errorCode(error) {
    return error instanceof ReaderError && codes.has(error.code) ? error.code : "READ_FAILED";
  }
  async function readCommand(api, command) {
    try {
      validate(command);
      const account = await api.accounts.get(command.accountId);
      if (!account) throw new ReaderError("ACCOUNT_NOT_FOUND");
      if (account.id !== command.accountId) throw new ReaderError("OUT_OF_SCOPE");
      if (command.type === "getMessage") {
        const header = await api.messages.get(command.messageId);
        if (!header) throw new ReaderError("MESSAGE_NOT_FOUND");
        assertScope(header, command.accountId);
        if (header.id !== command.messageId) throw new ReaderError("OUT_OF_SCOPE");
        if (header.size > maximumBytes) throw new ReaderError("TOO_LARGE");
        const full = await api.messages.getFull(command.messageId);
        const body = readBody(full);
        return bounded({ accountId: command.accountId, message: { ...summary(header), ...body } });
      }
      const folders = await api.folders.query({ accountId: command.accountId, specialUse: ["inbox"] });
      if (!Array.isArray(folders)) throw new ReaderError("READ_FAILED");
      if (folders.some((folder) => folder.accountId !== command.accountId || !folder.id || folder.isVirtual || folder.isUnified))
        throw new ReaderError("OUT_OF_SCOPE");
      if (command.type === "readAccount")
        return { accountId: command.accountId, account: { id: command.accountId, ready: true, inboxFound: folders.length > 0 } };
      if (folders.length !== 1) throw new ReaderError("READ_FAILED");
      const maxResults = command.maxResults ?? 25;
      const page = await api.messages.query({ folderId: folders[0].id, messagesPerPage: maxResults });
      try {
        if (!Array.isArray(page?.messages)) throw new ReaderError("READ_FAILED");
        const messages = page.messages.slice(0, maxResults).map((header) => {
          assertScope(header, command.accountId);
          if (header.folder.id !== folders[0].id) throw new ReaderError("OUT_OF_SCOPE");
          return summary(header);
        });
        return bounded({ accountId: command.accountId, messages });
      } finally {
        if (page?.id) await api.messages.abortList(page.id);
      }
    } catch (error) {
      throw new ReaderError(errorCode(error));
    }
  }
  function validate(command) {
    if (!command || typeof command !== "object" || Array.isArray(command) ||
      typeof command.nonce !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(command.nonce) ||
      typeof command.accountId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(command.accountId))
      throw new ReaderError("UNSUPPORTED");
    const keys = ["nonce", "type", "accountId"];
    if (command.type === "listInbox") keys.push("maxResults");
    else if (command.type === "getMessage") keys.push("messageId");
    else if (command.type !== "readAccount") throw new ReaderError("UNSUPPORTED");
    if (Object.keys(command).some((key) => !keys.includes(key)) ||
      (command.type === "listInbox" && command.maxResults !== undefined && (!Number.isInteger(command.maxResults) || command.maxResults < 1 || command.maxResults > 25)) ||
      (command.type === "getMessage" && (!Number.isSafeInteger(command.messageId) || command.messageId < 1)))
      throw new ReaderError("UNSUPPORTED");
  }
  function assertScope(header, accountId) {
    if (header?.folder?.accountId !== accountId) throw new ReaderError("OUT_OF_SCOPE");
  }
  function summary(header) {
    if (!Number.isSafeInteger(header.id) || header.id < 1) throw new ReaderError("READ_FAILED");
    return { id: header.id, headerMessageId: text(header.headerMessageId, 2048), subject: text(header.subject, 8192), from: text(header.author, 8192), to: Array.isArray(header.recipients) ? header.recipients.slice(0, 50).map((value) => text(value, 8192)) : [], date: header.date instanceof Date ? header.date.toISOString() : text(header.date, 128), read: Boolean(header.read) };
  }
  function readBody(root) {
    const result = { textPlain: "", textHtml: "" };
    let parts = 0;
    function visit(part, depth) {
      if (++parts > 500 || depth > 20) throw new ReaderError("TOO_LARGE");
      if (!part || typeof part !== "object") throw new ReaderError("READ_FAILED");
      const disposition = part.headers?.["content-disposition"];
      if (part.name || (Array.isArray(disposition) && disposition.some((value) => /^attachment\b|;\s*filename=/i.test(value)))) return;
      const type = String(part.contentType ?? "").toLowerCase().split(";")[0].trim();
      if (type === "message/rfc822" && depth > 0) return;
      if ((type === "text/plain" || type === "text/html") && typeof part.body === "string") {
        const field = type === "text/plain" ? "textPlain" : "textHtml";
        result[field] += part.body;
        bounded(result);
      }
      if (Array.isArray(part.parts)) for (const child of part.parts) visit(child, depth + 1);
    }
    visit(root, 0);
    return result;
  }
  function text(value, limit) {
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") throw new ReaderError("READ_FAILED");
    if (value.length > limit) throw new ReaderError("TOO_LARGE");
    return value;
  }
  function bounded(value) {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maximumBytes) throw new ReaderError("TOO_LARGE");
    return value;
  }
  globalThis.InboxZeroThunderbirdReader = Object.freeze({ readCommand, errorCode });
})();
