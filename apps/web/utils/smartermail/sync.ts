import { randomUUID } from "node:crypto";
import { env } from "@/env";
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
const PROCESSING_BATCH_SIZE = 50;
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
    if (state.retryAt && state.retryAt > now) {
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
      take: PROCESSING_BATCH_SIZE,
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
    let leaseLost = false;
    const concurrency = env.SMARTERMAIL_SYNC_CONCURRENCY === 2 ? 2 : 1;
    for (let offset = 0; offset < queued.length; offset += concurrency) {
      const prepared: Array<{
        pending: (typeof queued)[number];
        message: ParsedMessage;
        keys: Set<string> | null;
      }> = [];
      for (const pending of queued.slice(offset, offset + concurrency)) {
        if (Date.now() - now.getTime() > 240_000) {
          budgetExceeded = true;
          break;
        }
        const renewed = await prisma.smarterMailSyncState.updateMany({
          where: {
            emailAccountId,
            leaseToken,
            enabled: true,
            leaseUntil: { gt: new Date() },
            emailAccount: { account: { disconnectedAt: null } },
          },
          data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
        });
        if (!renewed.count) {
          leaseLost = true;
          break;
        }
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
          message = present
            ? await provider.getMessage(pending.messageId)
            : null;
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

        let keys: Set<string> | null = null;
        if (concurrency === 2) {
          try {
            const thread = await provider.getThread(message.id, {
              complete: true,
            });
            keys = conversationKeys([message, ...thread.messages]);
          } catch {
            // Unresolved history cannot establish independent conversations.
          }
        }
        prepared.push({ pending, message, keys });
      }
      if (leaseLost) return { skipped: true };
      const execute = async ({
        pending,
        message,
      }: (typeof prepared)[number]) => {
        if (Date.now() - now.getTime() > 240_000) {
          budgetExceeded = true;
          return;
        }
        const renewed = await prisma.smarterMailSyncState.updateMany({
          where: {
            emailAccountId,
            leaseToken,
            enabled: true,
            leaseUntil: { gt: new Date() },
            emailAccount: { account: { disconnectedAt: null } },
          },
          data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
        });
        if (!renewed.count) {
          leaseLost = true;
          return;
        }
        if (Date.now() - now.getTime() > 240_000) {
          budgetExceeded = true;
          return;
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
      };
      const first = prepared[0];
      const second = prepared[1];
      const independent =
        first?.keys &&
        second?.keys &&
        ![...first.keys].some((key) => second.keys!.has(key));
      if (independent) {
        // Drain every started action before advancing checkpoints or releasing the lease.
        const outcomes = await Promise.allSettled(prepared.map(execute));
        const failure = outcomes.find(
          (outcome) => outcome.status === "rejected",
        );
        if (failure?.status === "rejected") throw failure.reason;
      } else if (first) {
        await execute(first);
        // Re-read a dependent message after its predecessor may have moved the conversation.
        if (second) offset--;
      }
      if (leaseLost) return { skipped: true };
      if (budgetExceeded) break;
    }
    const nextCursor =
      scanOffset === null
        ? budgetExceeded || queued.length === PROCESSING_BATCH_SIZE
          ? "process"
          : null
        : `scan:${Math.max(0, scanOffset - departures)}`;
    await releaseLease(emailAccountId, leaseToken, {
      cursor: nextCursor,
      failures: 0,
      retryAt: null,
      lastSyncedAt: new Date(),
      nextRunAt: new Date(Date.now() + (nextCursor === null ? 60_000 : 0)),
    });
    return {
      processed,
      reviewRequired,
      hasMore: nextCursor !== null,
    };
  } catch {
    const failures = state.failures + 1;
    const retryAt = new Date(
      Date.now() + Math.min(60 * 60_000, 60_000 * 2 ** Math.min(failures, 6)),
    );
    await releaseLease(emailAccountId, leaseToken, {
      failures,
      nextRunAt: retryAt,
      retryAt,
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
    retryAt?: Date | null;
    lastSyncedAt?: Date;
    nextRunAt?: Date;
  },
) {
  await prisma.smarterMailSyncState.updateMany({
    where: { emailAccountId, leaseToken },
    data: { ...data, leaseToken: null, leaseUntil: null },
  });
}

function conversationKeys(messages: ParsedMessage[]) {
  const keys = new Set<string>();
  for (const message of messages) {
    const own = message.headers["message-id"]?.trim();
    if (!own || !/^<[^<>\s]{1,998}>$/.test(own)) return null;
    keys.add(message.id);
    keys.add(own);
    for (const value of [
      message.headers.references,
      message.headers["in-reply-to"],
    ]) {
      if (!value?.trim()) continue;
      if (!/^(?:\s*<[^<>\s]{1,998}>\s*)+$/.test(value)) return null;
      for (const reference of value.match(/<[^<>\s]{1,998}>/g) ?? [])
        keys.add(reference);
    }
  }
  return keys;
}
