

(() => {
  const codes = globalThis.InboxZeroThunderbirdProtocol.errors;
  const pages = new Map();
  const maximumBytes = 1024 * 1024 - 1024;
  class ReaderError extends Error {
    constructor(code) { super(code); this.code = code; }
  }
  function errorCode(error) {
    return codes.has(error?.code ?? error?.message) ? (error.code ?? error.message) : "READ_FAILED";
  }
  async function readCommand(api, command, options = {}) {
    try {
      try {
        if (typeof command?.accountId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(command.accountId) || typeof command.nonce !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(command.nonce)) throw new Error("UNSUPPORTED");
        globalThis.InboxZeroThunderbirdProtocol.validate(command, command.accountId);
      } catch { throw new ReaderError("UNSUPPORTED"); }
      const account = await api.accounts.get(command.accountId);
      if (!account) throw new ReaderError("ACCOUNT_NOT_FOUND");
      if (account.id !== command.accountId) throw new ReaderError("OUT_OF_SCOPE");
      if (command.type === "getMessage") {
        const header = await resolveMessage(api, command);
        if (!header) throw new ReaderError("MESSAGE_NOT_FOUND");
        assertScope(header, command.accountId);

        if (header.size > maximumBytes) throw new ReaderError("TOO_LARGE");
        const full = await api.messages.getFull(header.id);
        const body = readBody(full);
        return bounded({ accountId: command.accountId, message: { ...summary(header), ...body, ...mimeHeaders(full) } });
      }
      if (command.type === "listFolders") {
        const all = await api.folders.query({ accountId: command.accountId });
        for (const folder of all) assertFolder(folder, command.accountId);
        return bounded({ accountId: command.accountId, folders: all.map(folderSummary) });
      }
      if (command.type === "listMessages") return await listMessages(api, command);
      if (globalThis.InboxZeroThunderbirdProtocol.writes.has(command.type)) return await writeCommand(api, command, account, options);
      const folders = await api.folders.query({ accountId: command.accountId, specialUse: ["inbox"] });
      if (!Array.isArray(folders)) throw new ReaderError("READ_FAILED");
      if (folders.some((folder) => folder.accountId !== command.accountId || !folder.id || folder.isVirtual || folder.isUnified))
        throw new ReaderError("OUT_OF_SCOPE");
      if (command.type === "readAccount")
        return { accountId: command.accountId, account: { id: command.accountId, email: text(account.identities?.[0]?.email, 320), ready: true, inboxFound: folders.length > 0 } };
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
  function assertScope(header, accountId) {
    if (header?.folder?.accountId !== accountId) throw new ReaderError("OUT_OF_SCOPE");
  }
  function summary(header) {
    if (!Number.isSafeInteger(header.id) || header.id < 1) throw new ReaderError("READ_FAILED");
    return { id: header.id, headerMessageId: text(header.headerMessageId, 2048), subject: text(header.subject, 8192), from: text(header.author, 8192), to: Array.isArray(header.recipients) ? header.recipients.slice(0, 50).map((value) => text(value, 8192)) : [], date: header.date instanceof Date ? header.date.toISOString() : text(header.date, 128), read: Boolean(header.read), flagged: Boolean(header.flagged), hasAttachments: Boolean(header.hasAttachments), folderId: header.folder.id };
  }
  function assertFolder(folder, accountId) {
    if (!folder || folder.accountId !== accountId || !folder.id || folder.isVirtual || folder.isUnified) throw new ReaderError("OUT_OF_SCOPE");
  }
  function folderSummary(folder) { return { id: folder.id, name: folder.name, path: folder.path, specialUse: folder.specialUse ?? [], isRoot: Boolean(folder.isRoot) }; }
  async function resolveMessage(api, command) {
    let header;
    try { header = await api.messages.get(command.messageId ?? command.replyToId); } catch { /* Native IDs expire on restart and moves. */ }
    const identity = command.identity;
    const matches = h => h?.folder?.accountId === command.accountId && (!identity || (h.headerMessageId === identity.headerMessageId && summary(h).date === identity.date && h.subject === identity.subject));
    if (matches(header)) return header;
    if (!identity) throw new ReaderError(header ? "OUT_OF_SCOPE" : "MESSAGE_NOT_FOUND");
    const folders = await api.folders.query({accountId: command.accountId});
    const ids = folders.filter(f => !f.isRoot && !f.isVirtual && !f.isUnified).map(f => { assertFolder(f,command.accountId); return f.id; });
    const page = await api.messages.query({folderId: ids, headerMessageId: identity.headerMessageId, messagesPerPage: 25});
    try {
      const candidates = page.messages.filter(matches);
      if (page.id || candidates.length !== 1) throw new ReaderError("MESSAGE_NOT_FOUND");
      return candidates[0];
    } finally { if (page.id) await api.messages.abortList(page.id); }
  }
  async function listMessages(api, command) {
    for (const [key,page] of pages) if (page.expires < Date.now()) { pages.delete(key); await api.messages.abortList(page.id).catch(() => undefined); }
    const binding = JSON.stringify([command.accountId,command.folderId ?? null,command.query ?? null,command.maxResults ?? 25]);
    let page;
    if (command.pageToken) {
      const pending = pages.get(command.pageToken);
      if (!pending || pending.binding !== binding) throw new ReaderError("STALE_PAGE");
      pages.delete(command.pageToken);
      page = await api.messages.continueList(pending.id);
    } else {
      let folderIds;
      if (command.folderId) {
        const folder = await api.folders.get(command.folderId); assertFolder(folder,command.accountId); folderIds = [folder.id];
      } else {
        const all = await api.folders.query({accountId:command.accountId,...(command.query ? {} : {specialUse:["inbox"]})});
        folderIds = all.filter(f => !f.isRoot && !f.isVirtual && !f.isUnified).map(f => { assertFolder(f,command.accountId); return f.id; });
      }
      if (!folderIds.length) throw new ReaderError("READ_FAILED");
      const query = {...command.query};
      for (const key of ["fromDate","toDate"]) if (query[key]) query[key] = new Date(query[key]);
      page = await api.messages.query({...query,folderId:folderIds,messagesPerPage:command.maxResults ?? 25});
    }
    try {
      if (!Array.isArray(page.messages) || page.messages.length > (command.maxResults ?? 25)) throw new ReaderError("READ_FAILED");
      const messages = page.messages.map(h => { assertScope(h,command.accountId); if (command.folderId && h.folder.id !== command.folderId) throw new ReaderError("OUT_OF_SCOPE"); return summary(h); });
      let nextPageToken;
      if (page.id) {
        if (pages.size >= 100) throw new ReaderError("READ_FAILED");
        nextPageToken = crypto.randomUUID();
        pages.set(nextPageToken,{id:page.id,binding,expires:Date.now()+120_000});
      }
      return bounded({accountId:command.accountId,messages,...(nextPageToken ? {nextPageToken} : {})});
    } catch (error) { if (page?.id) { for (const [key,value] of pages) if(value.id === page.id) pages.delete(key); await api.messages.abortList(page.id); } throw error; }
  }
  async function writeCommand(api, command, account, options) {
    if (command.type === "createFolder") {
      const parent = command.parentFolderId ? await api.folders.get(command.parentFolderId) : (await api.folders.query({accountId:command.accountId,isRoot:true}))[0];
      assertFolder(parent,command.accountId);
      const folder = await api.folders.create(parent.id,command.name); assertFolder(folder,command.accountId);
      return {accountId:command.accountId,folder:folderSummary(folder)};
    }
    if (command.type === "createDraft") {
      const identityId = options.draftsIdentityId;
      if (options.draftsAccountId !== command.accountId || !identityId || !account.identities?.some(identity => identity.id === identityId))
        throw new ReaderError("OUT_OF_SCOPE");
      const drafts = await api.folders.query({accountId:command.accountId,specialUse:["drafts"]});
      if (!Array.isArray(drafts) || drafts.length !== 1) throw new ReaderError("OUT_OF_SCOPE");
      assertFolder(drafts[0],command.accountId);
      const details = {identityId,to:command.to,subject:command.subject,plainTextBody:command.textPlain,isPlainText:true,
        overrideDefaultFcc:true,overrideDefaultFccFolder:"",additionalFccFolder:""};
      let tab;
      try {
        tab = command.replyToId ? await api.compose.beginReply((await resolveMessage(api,command)).id,"replyToSender",details) : await api.compose.beginNew(details);
        const saved = await api.compose.saveMessage(tab.id,{mode:"draft"});
        if (!Array.isArray(saved.messages) || !saved.messages.length) throw new ReaderError("READ_FAILED");
        for (const message of saved.messages) assertScope(message,command.accountId);
        const message = saved.messages[0];
        if (message.folder.id !== drafts[0].id) throw new ReaderError("OUT_OF_SCOPE");
        return {accountId:command.accountId,draftId:message.id,message:summary(message)};
      } finally { if (tab?.id) await api.tabs.remove(tab.id).catch(() => undefined); }
    }
    const header = await resolveMessage(api,command);
    if (command.type === "moveMessage") {
      const folder = await api.folders.get(command.destinationFolderId); assertFolder(folder,command.accountId);
      if (header.folder.id !== folder.id) await api.messages.move([header.id],folder.id);
      const moved = await resolveMessage(api,command);
      if (moved.folder.id !== folder.id) throw new ReaderError("WRITE_UNKNOWN");
      return {accountId:command.accountId,message:summary(moved)};
    }
    const update = {};
    for (const key of ["read","flagged"]) if (command[key] !== undefined) update[key] = command[key];
    await api.messages.update(header.id,update);
    const updated = await resolveMessage(api,command);
    if ((command.read !== undefined && Boolean(updated.read) !== command.read) || (command.flagged !== undefined && Boolean(updated.flagged) !== command.flagged)) throw new ReaderError("WRITE_UNKNOWN");
    return {accountId:command.accountId,message:summary(updated)};
  }
  function mimeHeaders(full) {
    const headers = {};
    for (const [key,field] of [["in-reply-to","inReplyTo"],["references","references"],["reply-to","replyTo"]]) if (Array.isArray(full.headers?.[key])) headers[field] = full.headers[key].join(" ").slice(0,8192);
    return headers;
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
