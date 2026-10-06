import { randomUUID } from "node:crypto";
import prisma from "@/utils/prisma";
import { createEmailProvider } from "@/utils/email/provider";
import { processSmarterMailMessage } from "@/utils/smartermail/sync-processing";
import { getWebhookEmailAccount } from "@/utils/webhook/validate-webhook-account";
import { getUserTier, hasAiAccess } from "@/utils/premium";
import type { Logger } from "@/utils/logger";

const PAGE_SIZE = 25;
const LEASE_MS = 10 * 60 * 1000;

export async function syncSmarterMailAccount(
  emailAccountId: string,
  logger: Logger,
) {
  const now = new Date();
  const leaseToken = randomUUID();
  const claim = await prisma.smarterMailSyncState.updateMany({
    where: {
      emailAccountId,
      enabled: true,
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
      emailAccount: {
        account: { provider: "smartermail", disconnectedAt: null },
      },
    },
    data: { leaseToken, leaseUntil: new Date(now.getTime() + LEASE_MS) },
  });
  if (!claim.count) return { skipped: true };

  const state = await prisma.smarterMailSyncState.findUniqueOrThrow({
    where: { emailAccountId },
  });
  try {
    if (state.failures > 0 && state.nextRunAt > now) {
      await releaseLease(emailAccountId, leaseToken, {});
      return { skipped: true };
    }
    const mailbox = await prisma.emailAccount.findUniqueOrThrow({
      where: { id: emailAccountId },
      select: { email: true },
    });
    const emailAccount = await getWebhookEmailAccount(
      { email: mailbox.email },
      logger,
    );
    if (
      !emailAccount ||
      emailAccount.account?.disconnectedAt ||
      emailAccount.account?.provider !== "smartermail"
    ) {
      await releaseLease(emailAccountId, leaseToken, { enabled: false });
      return { skipped: true };
    }
    if (
      !hasAiAccess(
        getUserTier(emailAccount.user.premium),
        !!emailAccount.user.aiApiKey,
      ) ||
      !emailAccount.rules.length
    ) {
      await releaseLease(emailAccountId, leaseToken, {
        nextRunAt: new Date(Date.now() + 60_000),
      });
      return { skipped: true };
    }
    const provider = await createEmailProvider({
      emailAccountId,
      provider: "smartermail",
      logger,
    });
    const page = await provider.getMessagesWithPagination({
      inboxOnly: true,
      maxResults: PAGE_SIZE,
      pageToken: state.cursor ?? undefined,
    });
    let processed = 0;
    let reviewRequired = 0;
    let budgetExceeded = false;
    for (const message of page.messages) {
      if (Date.now() - now.getTime() > 240_000) {
        budgetExceeded = true;
        break;
      }
      const renewed = await prisma.smarterMailSyncState.updateMany({
        where: {
          emailAccountId,
          leaseToken,
          enabled: true,
          emailAccount: { account: { disconnectedAt: null } },
        },
        data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
      });
      if (!renewed.count) return { skipped: true };
      const result = await processSmarterMailMessage({
        provider,
        message,
        rules: emailAccount.rules,
        emailAccount,
        isTest: false,
        modelType: "default",
        logger,
      });
      if (result === "completed") processed++;
      if (result === "review_required") reviewRequired++;
    }
    await releaseLease(emailAccountId, leaseToken, {
      cursor: budgetExceeded ? state.cursor : (page.nextPageToken ?? null),
      failures: 0,
      lastSyncedAt: new Date(),
      nextRunAt: new Date(Date.now() + 60_000),
    });
    return { processed, reviewRequired, hasMore: !!page.nextPageToken };
  } catch {
    const failures = state.failures + 1;
    await releaseLease(emailAccountId, leaseToken, {
      failures,
      nextRunAt: new Date(
        Date.now() + Math.min(60 * 60_000, 60_000 * 2 ** Math.min(failures, 6)),
      ),
    });
    logger.warn("SmarterMail sync failed; retry scheduled", { failures });
    throw new Error(
      "SmarterMail sync failed; check account connection and retry schedule",
    );
  }
}

async function releaseLease(
  emailAccountId: string,
  leaseToken: string,
  data: {
    enabled?: boolean;
    cursor?: string | null;
    failures?: number;
    lastSyncedAt?: Date;
    nextRunAt?: Date;
  },
) {
  await prisma.smarterMailSyncState.updateMany({
    where: { emailAccountId, leaseToken },
    data: { ...data, leaseToken: null, leaseUntil: null },
  });
}
