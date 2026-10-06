# SmarterMail accounts

Configure `SMARTERMAIL_ALLOWED_ORIGINS` on the application server with a comma-separated list of exact HTTPS origins, for example `https://mail.example.com`. This list is an administrator trust boundary: only include servers you operate or trust. Paths, query strings, and URL credentials are rejected. Private network servers may be explicitly listed but must use a valid trusted TLS certificate. Do not disable certificate verification.

Set `EMAIL_ENCRYPT_SECRET` and `EMAIL_ENCRYPT_SALT` using the application's existing encryption setup before connecting. Deploy database migrations before starting the updated application.

Sign in to Inbox Zero using an existing supported identity. In Accounts, choose **Add SmarterMail**, enter the server origin, mailbox email, and password. If the mailbox requires two-factor authentication, supply its authentication code when prompted. Passwords and MFA challenge credentials are never persisted. Access and refresh tokens use the existing Account encryption extension.

Repeat for each mailbox. Each mailbox has its own EmailAccount, provider account, refresh credentials, and server origin. A mailbox already associated with another user or provider cannot be claimed. To reconnect an expired connection, enter its original server and mailbox credentials again.

This connects mailboxes to an authenticated Inbox Zero user; it does not enable password-based application login or change existing authentication policy.

## Categories before automatic processing

Create the categories required by your rules in SmarterMail first. The provider can apply and remove existing categories, but creating, renaming, deleting, or recoloring categories is unavailable while the documented whole-settings replacement API lacks verified concurrency protection. Inbox Zero will report an explicit error when a required category does not exist; it will not overwrite the server's category collection.

For the application's standard processing labels, create these exact category names:

- `Inbox Zero/Archived`
- `Inbox Zero/Read`
- `Inbox Zero/Unsubscribed`
- `Inbox Zero/Processing`
- `Inbox Zero/Processed`
- `Inbox Zero/Assistant`

Also create the categories selected by your custom rules. Enable automatic processing only after checking those names and testing a harmless rule in a dedicated mailbox. Category creation is tracked in [issue #19](https://github.com/gr3enarr0w/inbox-zero/issues/19).

## Supported operations and remaining capabilities

The native provider supports inbox and folder reading, body/header normalization, structured sender/date/read/starred/category searches, existing category assignment, read/star flags, folder moves, archive/trash, personal contact search, and draft creation/update/deletion. Draft references use the server's stable MID and resolve the current UID before updates or deletion.

Conversation lookup reconstructs related history from RFC Message-ID, In-Reply-To, and References headers, with a maximum of 20 ancestor lookups and 100 matching header-search results. It rejects unrelated header matches. Mailbox lists still represent individual messages; missing or invalid threading headers limit the history available. Requests explicitly requiring a complete conversation fail if the candidate limit is reached.

The following capabilities return explicit unsupported-operation errors:

| Capability | Tracking issue |
| --- | --- |
| Sending, forwarding, and sending saved drafts with a verifiable sent-message receipt | [#8](https://github.com/gr3enarr0w/inbox-zero/issues/8) |
| Attachment downloads/uploads | [#18](https://github.com/gr3enarr0w/inbox-zero/issues/18) |
| Category creation and settings changes | [#19](https://github.com/gr3enarr0w/inbox-zero/issues/19) |
| Native server filters | [#20](https://github.com/gr3enarr0w/inbox-zero/issues/20) |
| Signature retrieval | [#21](https://github.com/gr3enarr0w/inbox-zero/issues/21) |
| Contact photos | [#22](https://github.com/gr3enarr0w/inbox-zero/issues/22) |
| Forwarding-address settings | [#23](https://github.com/gr3enarr0w/inbox-zero/issues/23) |
| Advanced bulk sender operations, participant queries, and reply-history checks | [#24](https://github.com/gr3enarr0w/inbox-zero/issues/24) |

Do not enable rules requiring these capabilities. Outbound send operations fail before making a mailbox mutation: the documented send response acknowledges success without returning a sent-message identifier, so retrying an acknowledged send could duplicate delivery. Existing AI classification is reused; this integration does not introduce a separate classifier.
