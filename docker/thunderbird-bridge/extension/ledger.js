(() => {
  function createLedger(storage, execute) {
    let active = false;
    return async command => {
      if (!globalThis.InboxZeroThunderbirdProtocol.writes.has(command.type)) return execute(command);
      if (active) throw new Error('WRITE_UNKNOWN');
      active = true;
      try {
        const {nonce, ...operation} = command;
        const encoded = new TextEncoder().encode(JSON.stringify(operation));
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoded))].map(v => v.toString(16).padStart(2,'0')).join('');
        const key = `operation:${command.operationId}`;
        const saved = (await storage.get(key))[key];
        if (saved) {
          if (saved.digest !== digest || saved.state !== 'completed') throw new Error('WRITE_UNKNOWN');
          return saved.result;
        }
        const all = await storage.get(null);
        if (Object.keys(all).filter(k => k.startsWith('operation:')).length >= 20_000) throw new Error('LEDGER_FULL');
        // Commit intent before touching mail; an interrupted write must never be replayed.
        await storage.set({[key]:{digest,state:'started'}});
        const result = await execute(command);
        await storage.set({[key]:{digest,state:'completed',result}});
        return result;
      } finally { active = false; }
    };
  }
  globalThis.InboxZeroThunderbirdLedger = Object.freeze({createLedger});
})();
