import prisma from "@/utils/prisma";
import type { SmarterMailStatsFolderState } from "@/generated/prisma/client";
import type { SmarterMailProvider } from "@/utils/email/smartermail";
import type { Logger } from "@/utils/logger";
import { saveParsedEmailMessages } from "@/utils/actions/stats-messages";
import { smarterMailMessageId } from "@/utils/smartermail/message";
import { SmarterMailMessageNotFoundError } from "@/utils/smartermail/errors";
import { SmarterMailStatsMetadataInconclusiveError } from "@/utils/smartermail/provider/stats-metadata";
import {
  markSmarterMailUidImported,
  retainSmarterMailAbsentMetadata,
} from "@/utils/smartermail/stats-uid-work";
import { withSmarterMailLocalSyncContext } from "@/utils/smartermail/local-sync-context";
import { hydrateImportedSenders } from "@/utils/categorize/senders/hydrate";

export async function refreshSmarterMailCachedMetadata(
  folder: SmarterMailStatsFolderState,
  provider: Pick<SmarterMailProvider, "getStatsMessage" | "getStatsMessages">,
  leaseToken: string,
  logger: Logger,
) {
  await withSmarterMailLocalSyncContext(
    folder.emailAccountId,
    "backfill",
    async () => {
      const missing = folder.uidScanComplete
        ? await prisma.smarterMailStatsUid.findMany({
            where: {
              emailAccountId: folder.emailAccountId,
              folderId: folder.folderId,
              generation: { not: folder.uidGeneration },
              removedAt: null,
            },
            orderBy: { uid: "asc" },
            take: 20,
          })
        : [];
      for (const row of missing) {
        const id = smarterMailMessageId(folder.folderId, Number(row.uid));
        try {
          const message = await provider.getStatsMessage(id);
          if (message.id !== id)
            throw new Error("Statistics reconciliation identity mismatch");
          await saveParsedEmailMessages(
            folder.emailAccountId,
            [message],
            logger,
            {
              generation: folder.generation,
              leaseToken,
              folderId: folder.folderId,
              folderGuid: folder.folderGuid,
            },
          );
          await markSmarterMailUidImported(folder, row.uid, leaseToken);
        } catch (error) {
          if (!(error instanceof SmarterMailMessageNotFoundError)) throw error;
          await retainSmarterMailAbsentMetadata(folder, row.uid, leaseToken);
        }
      }
      const cached = await prisma.emailMessage.findMany({
        where: {
          emailAccountId: folder.emailAccountId,
          providerFolderId: folder.folderId,
          removedAt: null,
          OR: [
            { lastCheckedAt: null },
            {
              lastCheckedAt: {
                lte: folder.refreshAfter ?? new Date(Date.now() - 300_000),
              },
            },
          ],
        },
        orderBy: [
          { lastCheckedAt: { sort: "asc", nulls: "first" } },
          { id: "asc" },
        ],
        take: 20 - missing.length,
      });
      if (!cached.length) return;
      let messages: Awaited<ReturnType<typeof provider.getStatsMessages>>;
      try {
        messages = await provider.getStatsMessages(
          cached.map((row) => row.messageId),
        );
      } catch (error) {
        if (
          !(error instanceof SmarterMailStatsMetadataInconclusiveError) &&
          !(error instanceof SmarterMailMessageNotFoundError)
        )
          throw error;
        messages = [];
        for (const row of cached) {
          try {
            messages.push(await provider.getStatsMessage(row.messageId));
          } catch (readError) {
            if (!(readError instanceof SmarterMailMessageNotFoundError))
              throw readError;
            if (row.providerUid !== null)
              await retainSmarterMailAbsentMetadata(
                folder,
                row.providerUid,
                leaseToken,
              );
          }
        }
      }
      await saveParsedEmailMessages(folder.emailAccountId, messages, logger, {
        generation: folder.generation,
        leaseToken,
        folderId: folder.folderId,
        folderGuid: folder.folderGuid,
      });
      await hydrateImportedSenders({
        emailAccountId: folder.emailAccountId,
        messages,
      });
    },
  );
}
