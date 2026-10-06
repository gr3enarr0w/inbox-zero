(() => {
  const writes = new Set(['moveMessage', 'updateMessage', 'createFolder', 'createDraft']);
  const errors = new Set(['ACCOUNT_NOT_FOUND','MESSAGE_NOT_FOUND','OUT_OF_SCOPE','READ_FAILED','UNSUPPORTED','TOO_LARGE','STALE_PAGE','WRITE_UNKNOWN','LEDGER_FULL']);
  function validate(input, accountId) {
    const fields = {
      readAccount: [], listInbox: ['maxResults'], listFolders: [],
      listMessages: ['folderId','maxResults','pageToken','query'],
      getMessage: ['messageId','identity'],
      moveMessage: ['operationId','messageId','identity','destinationFolderId'],
      updateMessage: ['operationId','messageId','identity','read','flagged'],
      createFolder: ['operationId','name','parentFolderId'],
      createDraft: ['operationId','replyToId','identity','to','subject','textPlain'],
    };
    const fail = () => { throw new Error('UNSUPPORTED'); };
    if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.hasOwn(fields,input.type) || Object.keys(input).some(k => !['nonce','accountId','type',...fields[input.type]].includes(k))) fail();
    if (input.accountId !== undefined && input.accountId !== accountId) fail();
    const token = v => typeof v === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v);
    if (input.nonce !== undefined && !token(input.nonce)) fail();
    const text = (v,max) => typeof v === 'string' && v.length > 0 && v.length <= max && !v.includes('\0');
    for (const key of ['folderId','destinationFolderId','parentFolderId']) if (input[key] !== undefined && !text(input[key],4096)) fail();
    for (const key of ['messageId','replyToId']) if (input[key] !== undefined && (!Number.isSafeInteger(input[key]) || input[key] < 1)) fail();
    if (['getMessage','moveMessage','updateMessage'].includes(input.type) && input.messageId === undefined) fail();
    if (writes.has(input.type) && !token(input.operationId)) fail();
    if (input.type === 'moveMessage' && !input.destinationFolderId) fail();
    if (input.type === 'createFolder' && (!text(input.name,128) || /[/\\\r\n]/.test(input.name) || ['.','..'].includes(input.name))) fail();
    for (const key of ['read','flagged']) if (input[key] !== undefined && typeof input[key] !== 'boolean') fail();
    if (input.type === 'updateMessage' && input.read === undefined && input.flagged === undefined) fail();
    if (input.identity !== undefined) {
      const v = input.identity;
      if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !['headerMessageId','date','subject'].includes(k)) || !text(v.headerMessageId,2048) || !text(v.date,128) || !Number.isFinite(Date.parse(v.date)) || typeof v.subject !== 'string' || v.subject.length > 8192) fail();
    }
    if (['moveMessage','updateMessage'].includes(input.type) && !input.identity) fail();
    if (input.type === 'createDraft') {
      if (!Array.isArray(input.to) || input.to.length < 1 || input.to.length > 50 || input.to.some(v => !text(v,8192) || /[\r\n]/.test(v)) || typeof input.subject !== 'string' || input.subject.length > 8192 || /[\r\n]/.test(input.subject) || typeof input.textPlain !== 'string' || input.textPlain.length > 200_000 || (input.replyToId !== undefined && !input.identity)) fail();
    }
    if (input.pageToken !== undefined && !token(input.pageToken)) fail();
    if (input.maxResults !== undefined && (!Number.isInteger(input.maxResults) || input.maxResults < 1 || input.maxResults > 25)) fail();
    if (input.query !== undefined) {
      const q = input.query;
      if (!q || typeof q !== 'object' || Array.isArray(q)) fail();
      for (const [k,v] of Object.entries(q)) {
        if (['read','flagged','attachment'].includes(k)) { if (typeof v !== 'boolean') fail(); }
        else if (['headerMessageId','author','recipients','fullText'].includes(k)) { if (!text(v,2048)) fail(); }
        else if (['fromDate','toDate'].includes(k)) { if (!text(v,128) || !Number.isFinite(Date.parse(v))) fail(); }
        else fail();
      }
    }
    return {...input, accountId};
  }
  globalThis.InboxZeroThunderbirdProtocol = Object.freeze({validate,writes,errors});
})();
