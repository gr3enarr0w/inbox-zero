import prisma from "@/utils/prisma";
import type { SmarterMailStatsFolderState } from "@/generated/prisma/client";
import type { SmarterMailProvider } from "@/utils/email/smartermail";
import type { Logger } from "@/utils/logger";
import { internalDateToDate } from "@/utils/date";
import { saveParsedEmailMessages } from "@/utils/actions/stats-messages";
import { hydrateImportedSenders } from "@/utils/categorize/senders/hydrate";
import { parseSmarterMailMessageId } from "@/utils/smartermail/message";
import { InvalidMailboxSyncCursorError } from "@/utils/email/mailbox-sync";
import { withSmarterMailLocalSyncContext } from "@/utils/smartermail/local-sync-context";
import { markSmarterMailUidImported } from "@/utils/smartermail/stats-uid-work";

export async function importSmarterMailFolderMetadata({
  folder,
  provider,
  leaseToken,
  logger,
}: {
  folder: SmarterMailStatsFolderState;
  provider: Pick<SmarterMailProvider, "getStatsMessagesWithPagination">;
  leaseToken: string;
  logger: Logger;
}) {
  const fence = () => ({
    emailAccountId: folder.emailAccountId,
    folderId: folder.folderId,
    generation: folder.generation,
    emailAccount: {
      smarterMailStatsImportState: {
        leaseToken,
        leaseUntil: { gt: new Date() },
      },
    },
  });
  let page: Awaited<ReturnType<typeof provider.getStatsMessagesWithPagination>>;
  try {
    page = await withSmarterMailLocalSyncContext(
      folder.emailAccountId,
      "backfill",
      () =>
        provider.getStatsMessagesWithPagination({
          folderId: folder.folderId,
          maxResults: 20,
          pageToken: folder.cursor ?? undefined,
          after: folder.after ?? undefined,
          before: folder.before,
        }),
    );
  } catch (error) {
    if (error instanceof InvalidMailboxSyncCursorError) {
      // Folder-local numeric checkpoints do not expire with a provider instance.
      await prisma.smarterMailStatsFolderState.updateMany({
        where: fence(),
        data: { cursor: null },
      });
    }
    throw error;
  }
  if (
    page.messages.some(
      (message) =>
        parseSmarterMailMessageId(message.id).folder !== folder.folderId ||
        !Number.isFinite(
          internalDateToDate(message.internalDate, {
            fallbackToNow: false,
          }).getTime(),
        ),
    )
  )
    throw new Error("Statistics import encountered invalid folder metadata");
  const saved = await saveParsedEmailMessages(
    folder.emailAccountId,
    page.messages,
    logger,
    {
      generation: folder.generation,
      leaseToken,
      folderId: folder.folderId,
      folderGuid: folder.folderGuid,
    },
  );
  await hydrateImportedSenders({
    emailAccountId: folder.emailAccountId,
    messages: page.messages,
  });
  for (const message of page.messages)
    await markSmarterMailUidImported(
      folder,
      BigInt(parseSmarterMailMessageId(message.id).uid),
      leaseToken,
    );
  const complete = !page.nextPageToken;
  const updated = await prisma.smarterMailStatsFolderState.updateMany({
    where: fence(),
    data: {
      cursor: page.nextPageToken ?? null,
      completedAt: complete ? new Date() : null,
      recentComplete:
        folder.recentComplete || (complete && folder.mode === "recent"),
      historyComplete:
        folder.historyComplete || (complete && folder.mode === "history"),
    },
  });
  if (!updated.count)
    throw new Error("Statistics import lost its account lease");
  return saved;
}
