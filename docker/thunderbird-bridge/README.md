# Thunderbird bridge

This companion connects one existing Thunderbird account to Inbox Zero. OAuth
sessions remain in Thunderbird; no tokens are exported or other application
identities reused. Supported operations are bounded mail reads and searches,
folder classification, read/star flags, and saving native drafts. Sending,
permanent deletion, calendar access, and draft replacement are unsupported.

## Private deployment

Use Thunderbird 140 ESR or later. Run the companion in the Thunderbird container's
network namespace. Default binding is loopback; to connect Inbox Zero, set
`BRIDGE_BIND_ADDRESS=0.0.0.0` and join Thunderbird to the private Docker network
used by Inbox Zero. Do not publish port 8787 or add a reverse proxy. Both roles
require distinct random bearer tokens with at least 32 bytes of entropy, stored
in mounted private files. Only the extension receives the bridge token; only
Inbox Zero receives the operator token.

Set `THUNDERBIRD_ACCOUNT_ID` to the native account ID. The broker fixes this binding
and refuses caller-supplied accounts. Package every JavaScript file listed in
`extension/manifest.json`, the manifest, and a private `config.json` into an XPI:

```json
{"bridgeToken":"REPLACE_WITH_BRIDGE_TOKEN"}
```

Draft saving is disabled by default. After pinning the selected identity's native
Drafts preference to its own IMAP mailbox, disabling additional FCC copies, and
verifying an owned Drafts folder exists, add `draftsAccountId` and
`draftsIdentityId` to the private extension configuration. These must match the
fixed account and an identity belonging to it. Thunderbird's supported APIs do
not expose its Drafts preference, so the administrator must verify and preserve
that profile configuration. The extension clears FCC copies and checks every
saved message's account scope.

Never commit the generated XPI or configuration. Install using Thunderbird's
add-on manager or a local enterprise `ExtensionSettings` policy, preserving
existing policies. The extension persists its write ledger in the Thunderbird
profile; retain that profile across updates. Recreate the companion whenever the
Thunderbird container is recreated so its shared network namespace stays valid.
Thunderbird host permission patterns omit ports; transport stays fixed to
`http://127.0.0.1:8787`.

In Inbox Zero configure `THUNDERBIRD_BRIDGE_URL`, `THUNDERBIRD_BRIDGE_TOKEN` (the
operator token), and `THUNDERBIRD_BRIDGE_OWNER_EMAIL` (the authorized Inbox Zero
user's login email, which may differ from the mailbox email). The owner can select
**Connect Thunderbird** on Accounts. The server obtains the mailbox identity
from the fixed native account and rejects account ownership conflicts. No browser
receives bridge credentials. Apply the database migrations before deployment.

## Protocol and recovery

`GET /health` reports liveness. Authenticated `GET /operator/status` reports poll
status. Operator commands use `POST /operator/commands`, with one outstanding
native command, up to four queued callers, and a 30 second total deadline. Reads include `readAccount`, `listFolders`,
`listMessages` (up to 25 headers per page), and `getMessage`.

Pagination continuations are scoped to account, folder, query, and page size,
expire after two minutes, and are single use. Restarted or expired scans resume
from the beginning; persisted message identities prevent duplicate automation.
Existing cached headers do not prove Thunderbird has fetched every cloud message.

Writes require an `operationId`. Message mutations additionally require an RFC
Message-ID, date, and subject anchor. Recycled native integer IDs cannot authorize
another message; moved or restarted IDs resolve only to a unique scoped match.
The extension records intent before invoking a native write and completion before
acknowledging it. Repeating a completed operation returns its recorded result.
Interrupted operations return `WRITE_UNKNOWN` and require review, never automatic
replay. The ledger stops writes at 20,000 operations rather than forgetting
idempotency history. Back up the profile; clearing ledger storage loses this guard.

The polling worker processes new Inbox messages using existing Inbox Zero rules.
Classifications map to folders; native draft saves remain unsent. Claimed work
from an interrupted worker is marked for review. Unsupported search syntax or
operations fail explicitly instead of returning misleading empty results.

References: Thunderbird [messages](https://webextension-api.thunderbird.net/en/esr-mv2/messages.html),
[compose](https://webextension-api.thunderbird.net/en/esr-mv2/compose.html),
[folders](https://webextension-api.thunderbird.net/en/esr-mv2/folders.html), and
[enterprise policies](https://thunderbird.github.io/policy-templates/).

```sh
node --test docker/thunderbird-bridge/server.test.mjs docker/thunderbird-bridge/extension/*.test.mjs
```
