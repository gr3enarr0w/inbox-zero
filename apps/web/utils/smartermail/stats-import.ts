import { randomUUID } from "node:crypto";
import prisma from "@/utils/prisma";
import type { EmailProvider } from "@/utils/email/types";
import type { Logger } from "@/utils/logger";
import { saveParsedEmailMessages } from "@/utils/actions/stats-messages";
import { hydrateImportedSenders } from "@/utils/categorize/senders/hydrate";
import { withSmarterMailLocalSyncContext } from "@/utils/smartermail/local-sync-context";
import { InvalidMailboxSyncCursorError } from "@/utils/email/mailbox-sync";
import { reconcileSmarterMailStats } from "@/utils/smartermail/stats-prune";
import { internalDateToDate } from "@/utils/date";

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
    },
    update: {},
  });
  const token = randomUUID();
  const lease = await prisma.smarterMailStatsImportState.updateMany({
    where: {
      emailAccountId,
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
      emailAccount: {
        account: { provider: "smartermail", disconnectedAt: null },
      },
    },
    data: { leaseToken: token, leaseUntil: new Date(now.getTime() + 180_000) },
  });
  if (!lease.count) return progress(state.totalImported, false, 0);
  const fence = () => ({
    emailAccountId,
    leaseToken: token,
    leaseUntil: { gt: new Date() },
  });
  try {
    state = await prisma.smarterMailStatsImportState.findUniqueOrThrow({
      where: { emailAccountId },
    });
    if (state.nextRunAt > new Date()) {
      await prisma.smarterMailStatsImportState.updateMany({
        where: fence(),
        data: { leaseToken: null, leaseUntil: null },
      });
      return {
        ...progress(state.totalImported, false, 0),
        importError: state.importError,
      };
    }
    if (state.completedAt) {
      const extendHistory =
        loadBefore && !state.historyComplete && !!state.after;
      if (
        !extendHistory &&
        Date.now() - state.completedAt.getTime() < 300_000
      ) {
        await prisma.smarterMailStatsImportState.updateMany({
          where: fence(),
          data: { leaseToken: null, leaseUntil: null },
        });
        return progress(state.totalImported, true, 0);
      }
      const bounds = extendHistory
        ? { after: null, before: state.after! }
        : { after: state.after, before: now };
      const reset = await prisma.smarterMailStatsImportState.updateMany({
        where: fence(),
        data: {
          ...bounds,
          generation: randomUUID(),
          phase: "scan",
          cursor: null,
          completedAt: null,
          importError: null,
        },
      });
      if (!reset.count) return progress(state.totalImported, false, 0);
      state = await prisma.smarterMailStatsImportState.findUniqueOrThrow({
        where: { emailAccountId },
      });
    }
    let saved = 0;
    let complete = false;
    let nextCursor: string | null = null;
    let phase = state.phase;
    if (phase === "prune") {
      complete = (
        await reconcileSmarterMailStats({
          emailAccountId,
          generation: state.generation,
          leaseToken: token,
          after: state.after,
          before: state.before,
          emailProvider,
          logger,
        })
      ).complete;
    } else {
      let page: Awaited<ReturnType<EmailProvider["searchMessages"]>>;
      try {
        page = await withSmarterMailLocalSyncContext(
          emailAccountId,
          "backfill",
          () => {
            const options = {
              query: "",
              maxResults: 20,
              pageToken: state.cursor ?? undefined,
              after: state.after ?? undefined,
              before: state.before,
            };
            return emailProvider.searchMessages(options);
          },
        );
      } catch (error) {
        if (error instanceof InvalidMailboxSyncCursorError) {
          await prisma.smarterMailStatsImportState.updateMany({
            where: fence(),
            data: { cursor: null },
          });
        }
        throw error;
      }
      if (
        page.messages.some(
          (message) =>
            !Number.isFinite(
              internalDateToDate(message.internalDate, {
                fallbackToNow: false,
              }).getTime(),
            ),
        )
      )
        throw new Error(
          "Statistics import encountered a message without a valid date",
        );
      saved = await saveParsedEmailMessages(
        emailAccountId,
        page.messages,
        logger,
        { generation: state.generation, leaseToken: token },
      );
      await hydrateImportedSenders({ emailAccountId, messages: page.messages });
      nextCursor = page.nextPageToken ?? null;
      if (!page.nextPageToken) phase = "prune";
    }
    const totalImported = await prisma.emailMessage.count({
      where: { emailAccountId },
    });
    // Exhaustion starts verified reconciliation; offset pages are not exact snapshots.
    const checkpoint = await prisma.smarterMailStatsImportState.updateMany({
      where: fence(),
      data: {
        cursor: nextCursor,
        phase,
        totalImported,
        completedAt: complete ? new Date() : null,
        historyComplete: state.historyComplete || (complete && !state.after),
        importError: null,
        failures: 0,
        nextRunAt: new Date(),
        leaseToken: null,
        leaseUntil: null,
      },
    });
    if (!checkpoint.count) return progress(totalImported, false, saved);
    const needsOlder =
      complete && loadBefore && !state.historyComplete && !!state.after;
    return progress(totalImported, complete, saved, needsOlder, 1);
  } catch (error) {
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
}

function progress(
  totalImported: number,
  complete: boolean,
  saved: number,
  needsOlder = false,
  pages = 0,
) {
  return {
    pages,
    loadedAfterMessages: saved,
    loadedBeforeMessages: 0,
    hasMoreAfter: !complete,
    hasMoreBefore: needsOlder,
    complete: complete && !needsOlder,
    totalImported,
    importError: null,
  };
}
