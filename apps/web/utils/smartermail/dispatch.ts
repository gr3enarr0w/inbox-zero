import prisma from "@/utils/prisma";
import { enqueueBackgroundJob } from "@/utils/queue/dispatch";
import type { Logger } from "@/utils/logger";

export async function enqueueDueSmarterMailSyncs(logger: Logger) {
  const now = new Date();
  const states = await prisma.smarterMailSyncState.findMany({
    where: {
      enabled: true,
      nextRunAt: { lte: now },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
      emailAccount: {
        account: { provider: "smartermail", disconnectedAt: null },
      },
    },
    select: { emailAccountId: true, nextRunAt: true },
    orderBy: { nextRunAt: "asc" },
    take: 50,
  });
  let queued = 0;
  const reservedUntil = new Date(now.getTime() + 60_000);
  for (const state of states) {
    // Reserve dispatch briefly; workers take their own fenced processing lease.
    const claim = await prisma.smarterMailSyncState.updateMany({
      where: {
        emailAccountId: state.emailAccountId,
        enabled: true,
        nextRunAt: state.nextRunAt,
      },
      data: { nextRunAt: reservedUntil },
    });
    if (!claim.count) continue;
    try {
      await enqueueBackgroundJob({
        topic: "smartermail-sync",
        body: {
          emailAccountId: state.emailAccountId,
          reservedUntil: reservedUntil.toISOString(),
        },
        qstash: {
          queueName: "smartermail-sync",
          parallelism: 1,
          path: "/api/smartermail/sync",
        },
        logger,
      });
      queued++;
    } catch {
      logger.warn("SmarterMail sync dispatch failed", {
        emailAccountId: state.emailAccountId,
      });
    }
  }
  return { due: states.length, queued };
}
