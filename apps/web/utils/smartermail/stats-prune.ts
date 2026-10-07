import { Prisma } from "@/generated/prisma/client";
import type { ParsedMessage } from "@/utils/types";
import prisma from "@/utils/prisma";
import type { EmailProvider } from "@/utils/email/types";
import type { Logger } from "@/utils/logger";
import { SmarterMailMessageNotFoundError } from "@/utils/smartermail/errors";
import { saveParsedEmailMessages } from "@/utils/actions/stats-messages";
import { hydrateImportedSenders } from "@/utils/categorize/senders/hydrate";
import { withSmarterMailLocalSyncContext } from "@/utils/smartermail/local-sync-context";
import { internalDateToDate } from "@/utils/date";

export async function reconcileSmarterMailStats({
  emailAccountId,
  generation,
  leaseToken,
  after,
  before,
  emailProvider,
  logger,
}: {
  emailAccountId: string;
  generation: string;
  leaseToken: string;
  after: Date | null;
  before: Date;
  emailProvider: EmailProvider;
  logger: Logger;
}) {
  const unseen = {
    emailAccountId,
    date: { gte: after ?? undefined, lte: before },
    OR: [
      { smarterMailStatsGeneration: null },
      { smarterMailStatsGeneration: { not: generation } },
    ],
  };
  const pending = await prisma.emailMessage.findMany({
    where: unseen,
    orderBy: { id: "asc" },
    take: 20,
    select: { id: true, messageId: true },
  });
  await withSmarterMailLocalSyncContext(
    emailAccountId,
    "backfill",
    async () => {
      for (const row of pending) {
        let message: ParsedMessage;
        try {
          message = await emailProvider.getMessage(row.messageId);
        } catch (error) {
          if (!(error instanceof SmarterMailMessageNotFoundError)) throw error;
          await prisma.$executeRaw`
          WITH owned_state AS (
            SELECT "emailAccountId" FROM "SmarterMailStatsImportState"
            WHERE "emailAccountId" = ${emailAccountId} AND "generation" = ${generation}
              AND "leaseToken" = ${leaseToken} AND "leaseUntil" > NOW()
            FOR UPDATE
          )
          DELETE FROM "EmailMessage" WHERE "id" = ${row.id}
            AND "emailAccountId" = ${emailAccountId}
            AND "date" <= ${before}
            ${after ? Prisma.sql`AND "date" >= ${after}` : Prisma.sql``}
            AND ("smarterMailStatsGeneration" IS NULL OR "smarterMailStatsGeneration" <> ${generation})
            AND EXISTS (SELECT 1 FROM owned_state)
        `;
          continue;
        }
        if (
          message.id !== row.messageId ||
          !Number.isFinite(
            internalDateToDate(message.internalDate, {
              fallbackToNow: false,
            }).getTime(),
          )
        )
          throw new Error(
            "Statistics reconciliation message identity is invalid",
          );
        await saveParsedEmailMessages(emailAccountId, [message], logger, {
          generation,
          leaseToken,
        });
        await hydrateImportedSenders({ emailAccountId, messages: [message] });
      }
    },
  );
  return { complete: !(await prisma.emailMessage.count({ where: unseen })) };
}
