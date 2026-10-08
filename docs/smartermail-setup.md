# SmarterMail accounts

Configure `SMARTERMAIL_ALLOWED_ORIGINS` on the application server with a comma-separated list of exact HTTPS origins, for example `https://mail.example.com`. This list is an administrator trust boundary: only include servers you operate or trust. Paths, query strings, and URL credentials are rejected. Private network servers may be explicitly listed but must use a valid trusted TLS certificate. Do not disable certificate verification.

Set `EMAIL_ENCRYPT_SECRET` and `EMAIL_ENCRYPT_SALT` using the application's existing encryption setup before connecting. Deploy database migrations before starting the updated application.

Sign in to Inbox Zero using an existing supported identity. In Accounts, choose **Add SmarterMail**, enter the server origin, mailbox email, and password. If the mailbox requires two-factor authentication, supply its authentication code when prompted. Passwords and MFA challenge credentials are never persisted. Access and refresh tokens use the existing Account encryption extension.

Repeat for each mailbox. Each mailbox has its own EmailAccount, provider account, refresh credentials, and server origin. A mailbox already associated with another user or provider cannot be claimed. To reconnect an expired connection, enter its original server and mailbox credentials again.

This connects mailboxes to an authenticated Inbox Zero user; it does not enable password-based application login or change existing authentication policy.

## Calendar connection

After connecting a mailbox, open **Calendars** and choose **Add SmarterMail Calendar**. The connection reuses that mailbox's authenticated session; no separate OAuth registration or saved calendar password is required.

Personal calendars support event reading and availability checks. Shared calendars, subscribed calendars, tasks, and domain resources are excluded. Uncancelled events are conservatively treated as busy, so events marked free may reduce suggested availability. Queries are bounded to 93 days, 50 calendars, and 5,000 matching events in total; attendee detail searches require smaller windows when more than 25 events match.

Creating, editing, deleting, and responding to calendar invitations are not supported. SmarterMail calendars cannot be selected as booking destinations. Google and Microsoft calendar connections can still provide a booking destination.

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

Conversation lookup reconstructs related history from RFC Message-ID, In-Reply-To, and References headers using one search of up to 25 candidates. It rejects unrelated header matches and hydrates each candidate at most once. Mailbox lists still represent individual messages; missing or invalid threading headers limit the history available. Requests explicitly requiring a complete conversation report unsupported when the window is full or referenced messages are missing. Thread actions modify only the selected message; email headers cannot expand the scope of an action.

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

## Catch-up processing concurrency

`SMARTERMAIL_SYNC_CONCURRENCY` controls concurrent message processing within each mailbox. It defaults to `1` and accepts only `1` or `2`. Set it to `2` on the application server to overlap independent messages during catch-up; return it to `1` after catch-up. Queue worker counts control separate jobs and do not change this setting.

Messages with overlapping conversation references are processed sequentially. When conversation identity cannot be established, processing stays sequential. Started work finishes before the mailbox lease is released, and existing message claims and saved progress continue to apply. This setting does not change the metadata importer.

## Persistent statistics and sender data

The statistics importer saves email metadata, folder checkpoints, and the native message-ID inventory in PostgreSQL. Redis and browser caches are not the source of truth for these records. Restarting or replacing application containers resumes committed work using the same database. Initial imports show partial analytics and cleanup results while other folders continue.

Include `/api/cron/smartermail-stats` in the existing authenticated background scheduler so imports and refreshes continue when the browser is closed. Opening analytics or cleanup initializes the mailbox state. The scheduler processes a bounded batch for one due mailbox; database leases prevent concurrent workers from committing overlapping progress.

Each folder keeps its own progress. Completed history is reused; subsequent refreshes compare the folder's message-ID inventory and import new IDs. This also discovers older messages moved into a folder. Bounded metadata refreshes update the flags of cached messages without downloading their bodies again. Native ID lists still need periodic enumeration because the server does not provide a verified change feed.

Messages verified as absent are marked removed rather than deleted. A changed message identity or recreated folder retains the previous metadata version. Current analytics and cleanup queries exclude removed records, and the import notice reports retained history separately. Temporary API failures and malformed responses do not prove removal. Explicit account deletion still deletes that account's associated data.

For Docker installations, mount PostgreSQL's data directory on persistent host storage or a named volume, keep that same mount across deployments, and back it up separately from the application image. If Redis is used, persist its data directory as well. Replace application containers without removing the database volume. Before a database migration, take a database backup; after redeployment, verify that cached-record counts and completed folder checkpoints remain present before resuming background imports.
