import type { SmarterMailStatsFolderState } from "@/generated/prisma/client";
import type { SmarterMailProvider } from "@/utils/email/smartermail";
import type { Logger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import { saveParsedEmailMessages } from "@/utils/actions/stats-messages";
import { hydrateImportedSenders } from "@/utils/categorize/senders/hydrate";
import { smarterMailMessageId } from "@/utils/smartermail/message";
import { SmarterMailMessageNotFoundError } from "@/utils/smartermail/errors";
import { withSmarterMailLocalSyncContext } from "@/utils/smartermail/local-sync-context";
import { SmarterMailStatsMetadataInconclusiveError } from "@/utils/smartermail/provider/stats-metadata";

export async function importSmarterMailNewUids(
  folder: SmarterMailStatsFolderState,
  provider: Pick<SmarterMailProvider, "getStatsMessage" | "getStatsMessages">,
  leaseToken: string,
  logger: Logger,
) {
  const pending = await prisma.smarterMailStatsUid.findMany({
    where: {
      emailAccountId: folder.emailAccountId,
      folderId: folder.folderId,
      needsImport: true,
      removedAt: null,
    },
    orderBy: { uid: "desc" },
    take: 20,
  });
  let saved = 0;
  await withSmarterMailLocalSyncContext(
    folder.emailAccountId,
    "backfill",
    async () => {
      const cached = await prisma.emailMessage.findMany({
        where: {
          emailAccountId: folder.emailAccountId,
          providerFolderId: folder.folderId,
          providerFolderGuid: folder.folderGuid,
          providerUid: { in: pending.map((row) => row.uid) },
          removedAt: null,
        },
        select: { providerUid: true },
      });
      const cachedUids = new Set(cached.map((row) => String(row.providerUid)));
      const missing = pending.filter((row) => !cachedUids.has(String(row.uid)));
      let metadata = new Map<
        string,
        Awaited<ReturnType<typeof provider.getStatsMessage>>
      >();
      if (missing.length) {
        try {
          const messages = await provider.getStatsMessages(
            missing.map((row) =>
              smarterMailMessageId(folder.folderId, Number(row.uid)),
            ),
          );
          metadata = new Map(messages.map((message) => [message.id, message]));
        } catch (error) {
          if (!(error instanceof SmarterMailStatsMetadataInconclusiveError))
            throw error;
        }
      }
      for (const row of pending) {
        if (!cachedUids.has(String(row.uid))) {
          const id = smarterMailMessageId(folder.folderId, Number(row.uid));
          let message: Awaited<ReturnType<typeof provider.getStatsMessage>>;
          try {
            message = metadata.get(id) ?? (await provider.getStatsMessage(id));
          } catch (error) {
            if (!(error instanceof SmarterMailMessageNotFoundError))
              throw error;
            await retainSmarterMailAbsentMetadata(folder, row.uid, leaseToken);
            continue;
          }
          if (message.id !== id)
            throw new Error("Statistics UID identity mismatch");
          saved += await saveParsedEmailMessages(
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
          await hydrateImportedSenders({
            emailAccountId: folder.emailAccountId,
            messages: [message],
          });
        }
        await markSmarterMailUidImported(folder, row.uid, leaseToken);
      }
    },
  );
  return saved;
}

export async function markSmarterMailUidImported(
  folder: SmarterMailStatsFolderState,
  uid: bigint,
  leaseToken: string,
) {
  await prisma.$executeRaw`
    WITH owned_state AS (
      SELECT "emailAccountId" FROM "SmarterMailStatsImportState"
      WHERE "emailAccountId" = ${folder.emailAccountId} AND "leaseToken" = ${leaseToken} AND "leaseUntil" > NOW() FOR UPDATE
    )
    UPDATE "SmarterMailStatsUid" SET "needsImport" = false, "lastCheckedAt" = NOW(), "generation" = ${folder.uidGeneration}
    WHERE "emailAccountId" = ${folder.emailAccountId} AND "folderId" = ${folder.folderId} AND "uid" = ${uid}
      AND EXISTS (SELECT 1 FROM owned_state)
  `;
}

export async function retainSmarterMailAbsentMetadata(
  folder: SmarterMailStatsFolderState,
  uid: bigint,
  leaseToken: string,
) {
  await prisma.$executeRaw`
    WITH owned_state AS (
      SELECT "emailAccountId" FROM "SmarterMailStatsImportState"
      WHERE "emailAccountId" = ${folder.emailAccountId} AND "leaseToken" = ${leaseToken} AND "leaseUntil" > NOW() FOR UPDATE
    ), retained AS (
      UPDATE "EmailMessage" SET "removedAt" = NOW(), "lastCheckedAt" = NOW(), "updatedAt" = NOW()
      WHERE "emailAccountId" = ${folder.emailAccountId} AND "providerFolderId" = ${folder.folderId}
        AND "providerUid" = ${uid} AND "removedAt" IS NULL AND EXISTS (SELECT 1 FROM owned_state)
      RETURNING "id"
    )
    UPDATE "SmarterMailStatsUid" SET "needsImport" = false, "removedAt" = NOW(), "lastCheckedAt" = NOW()
    WHERE "emailAccountId" = ${folder.emailAccountId} AND "folderId" = ${folder.folderId} AND "uid" = ${uid}
      AND EXISTS (SELECT 1 FROM owned_state)
  `;
}

export async function retainSmarterMailFolderMetadata(
  folder: SmarterMailStatsFolderState,
  leaseToken: string,
) {
  await prisma.$executeRaw`
    WITH owned_state AS (
      SELECT "emailAccountId" FROM "SmarterMailStatsImportState"
      WHERE "emailAccountId" = ${folder.emailAccountId} AND "leaseToken" = ${leaseToken} AND "leaseUntil" > NOW() FOR UPDATE
    ), retained AS (
      UPDATE "EmailMessage" SET "removedAt" = NOW(), "lastCheckedAt" = NOW(), "updatedAt" = NOW()
      WHERE "emailAccountId" = ${folder.emailAccountId} AND "providerFolderId" = ${folder.folderId}
        AND "removedAt" IS NULL AND EXISTS (SELECT 1 FROM owned_state) RETURNING "id"
    )
    UPDATE "SmarterMailStatsUid" SET "needsImport" = false, "removedAt" = NOW(), "lastCheckedAt" = NOW()
    WHERE "emailAccountId" = ${folder.emailAccountId} AND "folderId" = ${folder.folderId}
      AND EXISTS (SELECT 1 FROM owned_state)
  `;
}
