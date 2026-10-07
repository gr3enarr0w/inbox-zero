import { randomUUID } from "node:crypto";
import prisma from "@/utils/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { SmarterMailProvider } from "@/utils/email/smartermail";
import type { SmarterMailStatsFolderState } from "@/generated/prisma/client";
import { InvalidMailboxSyncCursorError } from "@/utils/email/mailbox-sync";
import { withSmarterMailLocalSyncContext } from "@/utils/smartermail/local-sync-context";

export async function refreshSmarterMailUidIndex(
  initialFolder: SmarterMailStatsFolderState,
  provider: Pick<SmarterMailProvider, "getStatsFolderUids">,
  leaseToken: string,
) {
  let folder = initialFolder;
  if (folder.uidScanComplete && folder.uidNextRefreshAt > new Date()) return;
  const fence = () => ({
    emailAccountId: folder.emailAccountId,
    folderId: folder.folderId,
    emailAccount: {
      smarterMailStatsImportState: {
        leaseToken,
        leaseUntil: { gt: new Date() },
      },
    },
  });
  if (folder.uidScanComplete) {
    const generation = randomUUID();
    const changed = await prisma.smarterMailStatsFolderState.updateMany({
      where: fence(),
      data: {
        uidGeneration: generation,
        uidCursor: null,
        uidScanComplete: false,
      },
    });
    if (!changed.count)
      throw new Error("Statistics import lost its account lease");
    folder = {
      ...folder,
      uidGeneration: generation,
      uidCursor: null,
      uidScanComplete: false,
    };
  }
  await withSmarterMailLocalSyncContext(
    folder.emailAccountId,
    "backfill",
    async () => {
      // Only UID membership is scanned; previously imported message metadata is reused.
      for (let pageNumber = 0; pageNumber < 5; pageNumber++) {
        let page: Awaited<ReturnType<typeof provider.getStatsFolderUids>>;
        try {
          page = await provider.getStatsFolderUids({
            folderId: folder.folderId,
            pageToken: folder.uidCursor ?? undefined,
            maxResults: 1000,
          });
        } catch (error) {
          if (error instanceof InvalidMailboxSyncCursorError) {
            await prisma.smarterMailStatsFolderState.updateMany({
              where: fence(),
              data: { uidCursor: null, uidScanComplete: false },
            });
          }
          throw error;
        }
        if (page.uids.length) {
          const rows = page.uids.map(
            (uid) =>
              Prisma.sql`(${folder.emailAccountId}::text, ${folder.folderId}::text, ${uid}::bigint, ${folder.uidGeneration}::text, ${folder.folderGuid}::text, true)`,
          );
          const imported = await prisma.$executeRaw`
          WITH owned_state AS (
            SELECT "emailAccountId" FROM "SmarterMailStatsImportState"
            WHERE "emailAccountId" = ${folder.emailAccountId} AND "leaseToken" = ${leaseToken} AND "leaseUntil" > NOW()
            FOR UPDATE
          )
          INSERT INTO "SmarterMailStatsUid" ("emailAccountId", "folderId", "uid", "generation", "folderGuid", "needsImport")
          SELECT incoming."emailAccountId", incoming."folderId", incoming."uid", incoming."generation", incoming."folderGuid",
            NOT EXISTS (SELECT 1 FROM "EmailMessage" cached
              WHERE cached."emailAccountId" = incoming."emailAccountId" AND cached."providerFolderId" = incoming."folderId"
                AND cached."providerUid" = incoming."uid" AND cached."removedAt" IS NULL
                AND cached."providerFolderGuid" IS NOT DISTINCT FROM incoming."folderGuid")
          FROM (VALUES ${Prisma.join(rows)}) AS incoming("emailAccountId", "folderId", "uid", "generation", "folderGuid", "needsImport")
          WHERE EXISTS (SELECT 1 FROM owned_state)
          ON CONFLICT ("emailAccountId", "folderId", "uid") DO UPDATE SET
            "generation" = EXCLUDED."generation",
            "needsImport" = "SmarterMailStatsUid"."needsImport" OR "SmarterMailStatsUid"."removedAt" IS NOT NULL
              OR "SmarterMailStatsUid"."folderGuid" IS DISTINCT FROM EXCLUDED."folderGuid",
            "folderGuid" = EXCLUDED."folderGuid", "removedAt" = NULL
        `;
          if (imported !== page.uids.length)
            throw new Error("Statistics import lost its account lease");
        }
        const updated = await prisma.smarterMailStatsFolderState.updateMany({
          where: fence(),
          data: {
            uidCursor: page.nextPageToken ?? null,
            uidScanComplete: !page.nextPageToken,
            baselineComplete: folder.baselineComplete || !page.nextPageToken,
            uidNextRefreshAt: new Date(Date.now() + 300_000),
          },
        });
        if (!updated.count)
          throw new Error("Statistics import lost its account lease");
        if (!page.nextPageToken) break;
        folder = { ...folder, uidCursor: page.nextPageToken };
      }
    },
  );
}
