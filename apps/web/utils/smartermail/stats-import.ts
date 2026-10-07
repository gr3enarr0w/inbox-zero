import { randomUUID } from "node:crypto";
import prisma from "@/utils/prisma";
import type { EmailProvider } from "@/utils/email/types";
import type { SmarterMailProvider } from "@/utils/email/smartermail";
import type { Logger } from "@/utils/logger";
import { smarterMailFolderRole } from "@/utils/smartermail/message";
import { refreshSmarterMailUidIndex } from "@/utils/smartermail/stats-uid-index";
import { importSmarterMailFolderMetadata } from "@/utils/smartermail/stats-folder-import";
import { importSmarterMailNewUids } from "@/utils/smartermail/stats-uid-work";
import { retainSmarterMailFolderMetadata } from "@/utils/smartermail/stats-uid-work";
import { refreshSmarterMailCachedMetadata } from "@/utils/smartermail/stats-prune";
import {
  getSmarterMailLocalSyncContext,
  withSmarterMailLocalSyncContext,
} from "@/utils/smartermail/local-sync-context";

export async function loadSmarterMailStats({
  emailAccountId,
  emailProvider,
  logger,
  loadBefore,
}: {
  emailAccountId: string;
  emailProvider: EmailProvider;
  logger: Logger;
  loadBefore: boolean;
}) {
  const now = new Date();
  let state = await prisma.smarterMailStatsImportState.upsert({
    where: { emailAccountId },
    create: {
      emailAccountId,
      after: new Date(now.getTime() - 90 * 86_400_000),
      before: now,
      historyRequested: loadBefore,
    },
    update: loadBefore ? { historyRequested: true } : {},
  });
  const leaseToken = randomUUID();
  const acquired = await prisma.smarterMailStatsImportState.updateMany({
    where: {
      emailAccountId,
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
      emailAccount: {
        account: { provider: "smartermail", disconnectedAt: null },
      },
    },
    data: { leaseToken, leaseUntil: new Date(now.getTime() + 180_000) },
  });
  if (!acquired.count) return progress(state.totalImported, false, 0, 0);
  const fence = () => ({
    emailAccountId,
    leaseToken,
    leaseUntil: { gt: new Date() },
  });
  let activeFolderId: string | undefined;
  return withSmarterMailLocalSyncContext(
    emailAccountId,
    "backfill",
    async () => {
      try {
        state = await prisma.smarterMailStatsImportState.findUniqueOrThrow({
          where: { emailAccountId },
        });
        if (state.importError && state.nextRunAt > new Date()) {
          await prisma.smarterMailStatsImportState.updateMany({
            where: fence(),
            data: { leaseToken: null, leaseUntil: null },
          });
          return {
            ...progress(state.totalImported, false, 0, 0),
            importError: state.importError,
          };
        }
        if (emailProvider.name !== "smartermail")
          throw new Error("Statistics provider scope mismatch");
        const provider = emailProvider as SmarterMailProvider;
        const ownedInventory = await withSmarterMailLocalSyncContext(
          emailAccountId,
          "backfill",
          () => provider.getStatsFolders(),
        );
        const inventory = ownedInventory.filter(
          (folder) =>
            !["SPAM", "TRASH"].includes(smarterMailFolderRole(folder.id) ?? ""),
        );
        if (!inventory.length)
          throw new Error(
            "No owned mail folders were available for statistics",
          );
        const vanished = await prisma.smarterMailStatsFolderState.findMany({
          where: {
            emailAccountId,
            folderId: { notIn: ownedInventory.map((entry) => entry.id) },
          },
        });
        for (const folder of vanished)
          await retainSmarterMailFolderMetadata(folder, leaseToken);
        for (const entry of inventory) {
          const key = {
            emailAccountId_folderId: { emailAccountId, folderId: entry.id },
          };
          const folder = await prisma.smarterMailStatsFolderState.upsert({
            where: key,
            update: {},
            create: {
              emailAccountId,
              folderId: entry.id,
              folderGuid: entry.guid ?? null,
              after: state.after,
              before: state.before,
              historyBefore: state.after ?? new Date(0),
            },
          });
          if (folder.folderGuid !== (entry.guid ?? null)) {
            await retainSmarterMailFolderMetadata(folder, leaseToken);
            await prisma.smarterMailStatsFolderState.updateMany({
              where: {
                emailAccountId,
                folderId: entry.id,
                emailAccount: { smarterMailStatsImportState: fence() },
              },
              data: {
                folderGuid: entry.guid ?? null,
                uidCursor: null,
                uidScanComplete: false,
                uidGeneration: randomUUID(),
                baselineComplete: false,
                cursor: null,
                generation: randomUUID(),
                recentComplete: false,
                historyComplete: false,
                completedAt: null,
                mode: "recent",
                after: state.after,
                before: state.before,
                historyBefore: state.after ?? new Date(0),
              },
            });
          }
        }
        const folderIds = inventory.map((folder) => folder.id);
        const candidates = {
          emailAccountId,
          folderId: { in: folderIds },
          OR: [
            { recentComplete: false },
            { uidScanComplete: false },
            { uidNextRefreshAt: { lte: new Date() } },
            { nextRefreshAt: { lte: new Date() } },
            { uids: { some: { needsImport: true, removedAt: null } } },
            ...(state.historyRequested ? [{ historyComplete: false }] : []),
          ],
        };
        let folder = await prisma.smarterMailStatsFolderState.findFirst({
          where: {
            emailAccountId,
            folderId: { in: folderIds },
            OR: [
              { recentComplete: false },
              { baselineComplete: false },
              { uids: { some: { needsImport: true, removedAt: null } } },
              ...(state.historyRequested ? [{ historyComplete: false }] : []),
            ],
          },
          orderBy: { updatedAt: "asc" },
        });
        const overdueInventory =
          await prisma.smarterMailStatsFolderState.findFirst({
            where: {
              emailAccountId,
              folderId: { in: folderIds },
              baselineComplete: true,
              uidNextRefreshAt: { lte: new Date(Date.now() - 300_000) },
            },
            orderBy: { uidNextRefreshAt: "asc" },
          });
        folder = overdueInventory ?? folder;
        folder ??= await prisma.smarterMailStatsFolderState.findFirst({
          where: candidates,
          orderBy: { updatedAt: "asc" },
        });
        if (!state.totalImported) {
          const inbox = inventory.find(
            (entry) => smarterMailFolderRole(entry.id) === "INBOX",
          );
          if (inbox) {
            const first = await prisma.smarterMailStatsFolderState.findUnique({
              where: {
                emailAccountId_folderId: { emailAccountId, folderId: inbox.id },
              },
            });
            if (first && !first.recentComplete && !first.cursor) folder = first;
          }
        }
        let saved = 0;
        if (folder) {
          activeFolderId = folder.folderId;
          await refreshSmarterMailUidIndex(folder, provider, leaseToken);
          folder = await prisma.smarterMailStatsFolderState.findUniqueOrThrow({
            where: {
              emailAccountId_folderId: {
                emailAccountId,
                folderId: folder.folderId,
              },
            },
          });
          if (
            folder.recentComplete &&
            state.historyRequested &&
            !folder.historyComplete &&
            folder.mode !== "history"
          ) {
            const generation = randomUUID();
            const updated = await prisma.smarterMailStatsFolderState.updateMany(
              {
                where: {
                  emailAccountId,
                  folderId: folder.folderId,
                  emailAccount: { smarterMailStatsImportState: fence() },
                },
                data: {
                  mode: "history",
                  after: null,
                  before: folder.historyBefore,
                  cursor: null,
                  completedAt: null,
                  generation,
                },
              },
            );
            if (!updated.count)
              throw new Error("Statistics import lost its account lease");
            folder = {
              ...folder,
              mode: "history",
              after: null,
              before: folder.historyBefore,
              cursor: null,
              completedAt: null,
              generation,
            };
          }
          if (
            !folder.recentComplete ||
            (state.historyRequested && !folder.historyComplete)
          )
            saved += await importSmarterMailFolderMetadata({
              folder,
              provider,
              leaseToken,
              logger,
            });
          for (let batch = 0; batch < 5; batch++) {
            saved += await importSmarterMailNewUids(
              folder,
              provider,
              leaseToken,
              logger,
            );
            const remaining = await prisma.smarterMailStatsUid.count({
              where: {
                emailAccountId,
                folderId: folder.folderId,
                needsImport: true,
                removedAt: null,
              },
            });
            if (!remaining) break;
          }
          await refreshSmarterMailCachedMetadata(
            folder,
            provider,
            leaseToken,
            logger,
          );
          const remainingFlags = await prisma.emailMessage.count({
            where: {
              emailAccountId,
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
          });
          const remainingAbsences =
            folder.uidScanComplete &&
            (await prisma.smarterMailStatsUid.count({
              where: {
                emailAccountId,
                folderId: folder.folderId,
                removedAt: null,
                generation: { not: folder.uidGeneration },
              },
            }));
          const pendingMetadata = await prisma.smarterMailStatsUid.count({
            where: {
              emailAccountId,
              folderId: folder.folderId,
              needsImport: true,
              removedAt: null,
            },
          });
          const metadataComplete =
            folder.baselineComplete &&
            folder.uidScanComplete &&
            !pendingMetadata &&
            !remainingAbsences;
          const served = await prisma.smarterMailStatsFolderState.updateMany({
            where: {
              emailAccountId,
              folderId: folder.folderId,
              emailAccount: { smarterMailStatsImportState: fence() },
            },
            data: {
              ...(metadataComplete
                ? {
                    recentComplete: true,
                    historyComplete: true,
                    cursor: null,
                    completedAt: new Date(),
                  }
                : {}),
              nextRefreshAt: new Date(
                Date.now() +
                  (remainingFlags || remainingAbsences ? 0 : 300_000),
              ),
              refreshAfter: remainingFlags
                ? (folder.refreshAfter ?? new Date(Date.now() - 300_000))
                : new Date(),
              updatedAt: new Date(),
            },
          });
          if (!served.count)
            throw new Error("Statistics import lost its account lease");
        }
        const incomplete = await prisma.smarterMailStatsFolderState.count({
          where: {
            emailAccountId,
            folderId: { in: folderIds },
            OR: [
              { recentComplete: false },
              { baselineComplete: false },
              { uids: { some: { needsImport: true, removedAt: null } } },
              ...(state.historyRequested ? [{ historyComplete: false }] : []),
            ],
          },
        });
        const totalImported = await prisma.emailMessage.count({
          where: { emailAccountId, removedAt: null },
        });
        const totalRetained = await prisma.emailMessage.count({
          where: { emailAccountId, removedAt: { not: null } },
        });
        const complete = incomplete === 0;
        const pending = await prisma.smarterMailStatsFolderState.findFirst({
          where: candidates,
          select: { folderId: true },
        });
        const checkpoint = await prisma.smarterMailStatsImportState.updateMany({
          where: fence(),
          data: {
            totalImported,
            completedAt: complete ? new Date() : null,
            failures: 0,
            importError: null,
            nextRunAt: new Date(Date.now() + (pending ? 0 : 300_000)),
            leaseToken: null,
            leaseUntil: null,
          },
        });
        if (!checkpoint.count)
          return progress(totalImported, false, saved, 0, totalRetained);
        return progress(
          totalImported,
          complete,
          saved,
          folder ? 1 : 0,
          totalRetained,
        );
      } catch (error) {
        if (isOwnDeadline(error)) {
          const totalImported = await prisma.emailMessage.count({
            where: { emailAccountId, removedAt: null },
          });
          const totalRetained = await prisma.emailMessage.count({
            where: { emailAccountId, removedAt: { not: null } },
          });
          if (activeFolderId) {
            await prisma.smarterMailStatsFolderState.updateMany({
              where: {
                emailAccountId,
                folderId: activeFolderId,
                emailAccount: { smarterMailStatsImportState: fence() },
              },
              data: { updatedAt: new Date() },
            });
          }
          const checkpoint =
            await prisma.smarterMailStatsImportState.updateMany({
              where: fence(),
              data: {
                totalImported,
                completedAt: null,
                failures: 0,
                importError: null,
                nextRunAt: new Date(),
                leaseToken: null,
                leaseUntil: null,
              },
            });
          const saved = Math.max(0, totalImported - state.totalImported);
          return progress(
            totalImported,
            false,
            saved,
            checkpoint.count && saved ? 1 : 0,
            totalRetained,
          );
        }
        await prisma.smarterMailStatsImportState.updateMany({
          where: fence(),
          data: {
            importError: "Statistics import failed; retry to resume.",
            failures: { increment: 1 },
            nextRunAt: new Date(
              Date.now() +
                Math.min(3_600_000, 60_000 * 2 ** Math.min(state.failures, 6)),
            ),
            leaseToken: null,
            leaseUntil: null,
          },
        });
        throw error;
      }
    },
  );
}

function isOwnDeadline(error: unknown) {
  const signal = getSmarterMailLocalSyncContext()?.signal;
  if (!signal?.aborted || signal.reason?.name !== "TimeoutError") return false;
  return (
    error === signal.reason ||
    (error instanceof Error &&
      ["AbortError", "TimeoutError"].includes(error.name))
  );
}

function progress(
  totalImported: number,
  complete: boolean,
  saved: number,
  pages: number,
  totalRetained = 0,
) {
  return {
    pages,
    loadedAfterMessages: saved,
    loadedBeforeMessages: 0,
    hasMoreAfter: !complete,
    hasMoreBefore: false,
    complete,
    totalImported,
    totalRetained,
    importError: null,
  };
}
