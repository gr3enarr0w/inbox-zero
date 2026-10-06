

(() => {
  const messenger = globalThis.messenger;
  const reader = globalThis.InboxZeroThunderbirdReader;
  const baseUrl = "http://127.0.0.1:8787";
  const pause = () => new Promise((resolve) => setTimeout(resolve, 2000));
  async function run() {
    const configResponse = await fetch(messenger.runtime.getURL("config.json"));
    if (!configResponse.ok) return;
    const config = await configResponse.json();
    if (typeof config.bridgeToken !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(config.bridgeToken)) return;
    const headers = { Authorization: `Bearer ${config.bridgeToken}`, "Content-Type": "application/json" };
    while (true) {
      try {
        const response = await fetch(`${baseUrl}/bridge/commands`, { headers, signal: AbortSignal.timeout(30_000), redirect: "error", cache: "no-store" });
        if (response.status === 204) continue;
        if (!response.ok) { await pause(); continue; }
        const raw = await response.text();
        if (raw.length > 65_536) { await pause(); continue; }
        const command = JSON.parse(raw);
        let payload;
        try {
          const result = await reader.readCommand(messenger, command);
          payload = { nonce: command.nonce, result };
        } catch (error) {
          if (typeof command?.nonce !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(command.nonce)) continue;
          payload = { nonce: command.nonce, error: reader.errorCode(error) };
        }
        const delivered = await fetch(`${baseUrl}/bridge/results`, { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000), redirect: "error", cache: "no-store" });
        if (!delivered.ok) await pause();
      } catch { await pause(); }
    }
  }
  run().catch(() => undefined);
})();
