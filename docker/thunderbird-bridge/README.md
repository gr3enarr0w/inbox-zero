# Thunderbird bridge staging

This companion stages a private, read-only connection to one Thunderbird account.
It is **not yet an Inbox Zero email provider**: mailbox enrollment, classification,
folder mapping, durable action acknowledgements and draft persistence remain tracked
in the Thunderbird bridge issue. A healthy companion alone does not establish a
working email connection.

The MailExtension uses Thunderbird's existing account session. Microsoft OAuth
credentials remain in Thunderbird. There are no send, move, modify or compose
permissions, and no generic JavaScript execution endpoint.

## Deployment

Use Thunderbird 140 ESR or later. Run one companion per user/account, sharing the
Thunderbird container's network namespace. Its listener must stay on loopback;
do not publish the port or add a reverse proxy. Thunderbird host-permission patterns do not support port numbers; the manifest permits loopback HTTP while the extension transport remains fixed to port 8787. Generate two different random
bearer tokens of at least 32 bytes, store them in private files, and mount them
read-only at the paths in `compose.example.yml`. The operator token must not be
included in the extension.

Set `THUNDERBIRD_ACCOUNT_ID` to the selected account's actual Thunderbird account
ID. Do not infer it from its email address or a folder path. The operator cannot
select another account. See Thunderbird's [accounts API](https://webextension-api.thunderbird.net/en/esr-mv2/accounts.html).

Package `extension/manifest.json`, `extension/background.js` and
`extension/reader.js` and `extension/bounded-read.js` as an XPI with a private `config.json`:

```json
{"bridgeToken":"REPLACE_WITH_BRIDGE_TOKEN"}
```

Keep the generated XPI private: it contains the bridge bearer token. Neither the
configuration nor the packaged XPI belongs in Git. Install it through Thunderbird's
add-on manager or an existing enterprise `ExtensionSettings` policy using a
local `file:///` install URL. Preserve unrelated enterprise policies. See the
[Thunderbird policy documentation](https://thunderbird.github.io/policy-templates/).

Start the companion, then start/restart Thunderbird so the extension connects.
Use `GET /health` for liveness and authenticated `GET /operator/status` to check
whether the extension is polling. Neither endpoint reports message contents.

## Read-only verification

Operator requests use `Authorization: Bearer OPERATOR_TOKEN`:

- `POST /operator/commands` with `{"type":"readAccount"}` verifies the selected
  account and its Inbox.
- `{"type":"listInbox","maxResults":25}` reads a bounded page of message headers.
- `{"type":"getMessage","messageId":123}` reads one message from the selected
  account. The extension verifies ownership before fetching its body.

All commands have deadlines; only one may be outstanding. Results are transient,
not stored by the companion. Read errors are sanitized. Missing or mismatched
account scope fails closed. Thunderbird's integer message IDs are ephemeral and
must not serve as durable idempotency keys for a future action integration.

The extension uses the documented [message API](https://webextension-api.thunderbird.net/en/esr-mv2/messages.html)
and aborts unused list continuations. It does not verify delivery of new server
messages merely by returning existing cached headers; verify a live read before
claiming school synchronization is working.

Run companion and reader tests with Node 24:

```sh
node --test docker/thunderbird-bridge/server.test.mjs docker/thunderbird-bridge/extension/reader.test.mjs docker/thunderbird-bridge/extension/bounded-read.test.mjs
```
