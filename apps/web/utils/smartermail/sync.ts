import { randomUUID } from "node:crypto";
import prisma from "@/utils/prisma";
import { createEmailProvider } from "@/utils/email/provider";
import {
  getSmarterMailSyncMessageKey,
  processSmarterMailMessage,
} from "@/utils/smartermail/sync-processing";
import type { SmarterMailProvider } from "@/utils/email/smartermail";
import { parseSmarterMailMessageId } from "@/utils/smartermail/message";
import { getWebhookEmailAccount } from "@/utils/webhook/validate-webhook-account";
import { getUserTier, hasAiAccess } from "@/utils/premium";
import type { Logger } from "@/utils/logger";
import type { ParsedMessage } from "@/utils/types";
import { SmarterMailMessageNotFoundError } from "@/utils/smartermail/errors";

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
    // A reclaimed lease cannot prove whether the previous worker sent an action.
    await prisma.smarterMailSyncMessage.updateMany({
      where: {
        emailAccountId,
        status: "claimed",
        createdAt: { lt: now },
        emailAccount: {
          smarterMailSyncState: {
            enabled: true,
            leaseToken,
            leaseUntil: { gt: new Date() },
          },
        },
      },
      data: { status: "review_required", processedAt: now },
    });
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
    const provider = (await createEmailProvider({
      emailAccountId,
      provider: "smartermail",
      logger,
    })) as SmarterMailProvider;
    let cursor = state.cursor;
    if (cursor !== "process") {
      const page = await provider.getMessagesWithPagination({
        inboxOnly: true,
        maxResults: PAGE_SIZE,
        pageToken: cursor?.startsWith("scan:") ? cursor.slice(5) : undefined,
      });
      await prisma.smarterMailSyncMessage.createMany({
        data: page.messages.map((message) => ({
          emailAccountId,
          messageId: message.id,
          messageKey: getSmarterMailSyncMessageKey(message),
          status: "queued",
        })),
        skipDuplicates: true,
      });
      cursor = page.nextPageToken ? `scan:${page.nextPageToken}` : "process";
    }
    const queued = await prisma.smarterMailSyncMessage.findMany({
      where: { emailAccountId, status: "queued" },
      orderBy: [{ createdAt: "asc" }, { messageKey: "asc" }],
      take: PAGE_SIZE,
    });
    const scanOffset = cursor?.startsWith("scan:")
      ? Number(cursor.slice(5))
      : null;
    const recoveryCursor =
      scanOffset === null
        ? "process"
        : `scan:${Math.max(0, scanOffset - queued.length)}`;
    // Replaying a rewound scan is safe; losing a checkpoint after moves must not skip mail.
    const checkpoint = await prisma.smarterMailSyncState.updateMany({
      where: {
        emailAccountId,
        leaseToken,
        enabled: true,
        leaseUntil: { gt: new Date() },
      },
      data: { cursor: recoveryCursor },
    });
    if (!checkpoint.count) return { skipped: true };
    let departures = 0;
    let processed = 0;
    let reviewRequired = 0;
    let budgetExceeded = false;
    for (const pending of queued) {
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
      let message: ParsedMessage | null = null;
      let failureStatus = "skipped";
      let confirmedAbsent = false;
      try {
        const { folder } = parseSmarterMailMessageId(pending.messageId);
        failureStatus = "retry_ready";
        const present =
          (await provider.hasMessagesInFolder(folder, [pending.messageId]))
            .length > 0;
        confirmedAbsent = !present;
        message = present ? await provider.getMessage(pending.messageId) : null;
        if (
          message &&
          getSmarterMailSyncMessageKey(message) !== pending.messageKey
        )
          message = null;
        failureStatus = "skipped";
      } catch (error) {
        // These reads precede claiming the message or starting any rule actions.
        if (error instanceof SmarterMailMessageNotFoundError) {
          confirmedAbsent = true;
          failureStatus = "skipped";
        }
        message = null;
      }
      if (!message) {
        if (confirmedAbsent) departures++;
        await prisma.smarterMailSyncMessage.updateMany({
          where: {
            emailAccountId,
            messageKey: pending.messageKey,
            status: "queued",
            emailAccount: {
              smarterMailSyncState: {
                enabled: true,
                leaseToken,
                leaseUntil: { gt: new Date() },
              },
            },
          },
          data: { status: failureStatus, processedAt: new Date() },
        });
        continue;
      }
      const result = await processSmarterMailMessage(
        {
          provider,
          message,
          rules: emailAccount.rules,
          emailAccount,
          isTest: false,
          modelType: "default",
          logger,
        },
        leaseToken,
        pending.messageKey,
      );
      if (result === "completed") processed++;
      if (result === "review_required") reviewRequired++;
      const { folder } = parseSmarterMailMessageId(pending.messageId);
      if (
        !(await provider.hasMessagesInFolder(folder, [pending.messageId]))
          .length
      )
        departures++;
    }
    const nextCursor = budgetExceeded
      ? recoveryCursor
      : scanOffset === null
        ? queued.length === PAGE_SIZE
          ? "process"
          : null
        : `scan:${Math.max(0, scanOffset - departures)}`;
    await releaseLease(emailAccountId, leaseToken, {
      cursor: nextCursor,
      failures: 0,
      lastSyncedAt: new Date(),
      nextRunAt: new Date(Date.now() + 60_000),
    });
    return {
      processed,
      reviewRequired,
      hasMore: nextCursor !== null,
    };
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
