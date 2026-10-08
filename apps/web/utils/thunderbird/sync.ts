import { randomUUID } from "node:crypto";
import prisma from "@/utils/prisma";
import { ActionType } from "@/generated/prisma/enums";
import { createEmailProvider } from "@/utils/email/provider";
import { getWebhookEmailAccount } from "@/utils/webhook/validate-webhook-account";
import { getUserTier, hasAiAccess } from "@/utils/premium";
import {
  getThunderbirdSyncMessageKey,
  isThunderbirdReadPendingStatus,
  processThunderbirdSyncMessage,
} from "@/utils/thunderbird/sync-processing";
import { ThunderbirdBridgeError } from "@/utils/thunderbird/errors";
import type { Logger } from "@/utils/logger";
import type { ParsedMessage } from "@/utils/types";

const supportedActions: ReadonlySet<ActionType> = new Set([
  ActionType.ARCHIVE,
  ActionType.LABEL,
  ActionType.MOVE_FOLDER,
  ActionType.DRAFT_EMAIL,
  ActionType.MARK_READ,
  ActionType.STAR,
]);

// Persisted states bound retries across worker restarts without replaying claimed writes.
const readRetryTransitions: Readonly<Record<string, string>> = {
  queued: "read_retry_1",
  retry_ready: "read_retry_1",
  read_retry_1: "read_retry_2",
  read_retry_2: "read_failed",
};

export async function syncThunderbirdAccount(
  emailAccountId: string,
  logger: Logger,
) {
  const started = new Date();
  const leaseToken = randomUUID();
  const fence = {
    emailAccountId,
    enabled: true,
    leaseToken,
    leaseUntil: { gt: new Date() },
  };
  const acquired = await prisma.thunderbirdSyncState.updateMany({
    where: {
      emailAccountId,
      enabled: true,
      nextRunAt: { lte: started },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: started } }],
      emailAccount: {
        account: { provider: "thunderbird", disconnectedAt: null },
      },
    },
    data: { leaseToken, leaseUntil: new Date(Date.now() + 600_000) },
  });
  if (!acquired.count) return { skipped: true };
  const state = await prisma.thunderbirdSyncState.findUniqueOrThrow({
    where: { emailAccountId },
  });
  try {
    await prisma.thunderbirdSyncMessage.updateMany({
      where: {
        emailAccountId,
        status: "claimed",
        emailAccount: { thunderbirdSyncState: fence },
      },
      data: { status: "review_required", processedAt: new Date() },
    });
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
      emailAccount.id !== emailAccountId ||
      emailAccount.account?.provider !== "thunderbird" ||
      emailAccount.account.disconnectedAt
    ) {
      await release(emailAccountId, leaseToken, { enabled: false });
      return { skipped: true };
    }
    const rules = emailAccount.rules
      .map((rule) => ({
        ...rule,
        actions: rule.actions.filter((action) =>
          supportedActions.has(action.type),
        ),
      }))
      .filter((rule) => rule.actions.length > 0);
    if (
      !rules.length ||
      !hasAiAccess(
        getUserTier(emailAccount.user.premium),
        !!emailAccount.user.aiApiKey,
      )
    ) {
      await release(emailAccountId, leaseToken, {
        nextRunAt: new Date(Date.now() + 60_000),
      });
      return { skipped: true };
    }
    const provider = await createEmailProvider({
      emailAccountId,
      provider: "thunderbird",
      logger,
    });
    let page: Awaited<ReturnType<typeof provider.getMessagesWithPagination>>;
    try {
      page = await provider.getMessagesWithPagination({
        inboxOnly: true,
        maxResults: 25,
        pageToken: state.cursor ?? undefined,
      });
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        error.code !== "STALE_PAGE"
      )
        throw error;
      page = await provider.getMessagesWithPagination({
        inboxOnly: true,
        maxResults: 25,
      });
    }
    await prisma.thunderbirdSyncMessage.createMany({
      data: page.messages.map((message) => ({
        emailAccountId,
        messageId: message.id,
        messageKey: getThunderbirdSyncMessageKey(emailAccountId, message),
      })),
      skipDuplicates: true,
    });
    // Native continuation tokens are single-use; persist the next token before actions.
    const checkpoint = await prisma.thunderbirdSyncState.updateMany({
      where: fence,
      data: { cursor: page.nextPageToken ?? null },
    });
    if (!checkpoint.count) return { skipped: true };
    const queued = await prisma.thunderbirdSyncMessage.findMany({
      where: {
        emailAccountId,
        OR: [
          { status: "queued" },
          {
            status: { in: ["retry_ready", "read_retry_1", "read_retry_2"] },
            OR: [
              { processedAt: null },
              { processedAt: { lte: new Date(Date.now() - 60_000) } },
            ],
          },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { messageKey: "asc" }],
      take: 25,
    });
    let processed = 0;
    for (const pending of queued) {
      if (Date.now() - started.getTime() > 240_000) break;
      const renewed = await prisma.thunderbirdSyncState.updateMany({
        where: { ...fence, leaseUntil: { gt: new Date() } },
        data: { leaseUntil: new Date(Date.now() + 600_000) },
      });
      if (!renewed.count) return { skipped: true };
      const pendingStatus = pending.status;
      if (!isThunderbirdReadPendingStatus(pendingStatus)) continue;
      const pendingFence = () => ({
        emailAccountId,
        messageKey: pending.messageKey,
        status: pendingStatus,
        emailAccount: {
          thunderbirdSyncState: { ...fence, leaseUntil: { gt: new Date() } },
        },
      });
      let message: ParsedMessage;
      try {
        message = await provider.getMessage(pending.messageId);
      } catch (error) {
        const transient =
          error instanceof ThunderbirdBridgeError &&
          (error.code === "READ_FAILED" || error.code === "TIMEOUT");
        const retryStatus = transient
          ? (readRetryTransitions[pendingStatus] ?? "review_required")
          : "review_required";
        await prisma.thunderbirdSyncMessage.updateMany({
          where: pendingFence(),
          data: { status: retryStatus, processedAt: new Date() },
        });
        continue;
      }
      try {
        if (
          getThunderbirdSyncMessageKey(emailAccountId, message) !==
          pending.messageKey
        )
          throw new Error("Thunderbird queued identity changed");
      } catch {
        await prisma.thunderbirdSyncMessage.updateMany({
          where: pendingFence(),
          data: { status: "review_required", processedAt: new Date() },
        });
        continue;
      }
      const status = await processThunderbirdSyncMessage(
        {
          provider,
          message,
          rules,
          emailAccount,
          isTest: false,
          modelType: "default",
          logger,
        },
        leaseToken,
        pending.messageKey,
        pendingStatus,
      );
      if (status === "completed") processed++;
    }
    const remaining = await prisma.thunderbirdSyncMessage.count({
      where: { emailAccountId, status: "queued" },
    });
    await release(emailAccountId, leaseToken, {
      failures: 0,
      lastSyncedAt: new Date(),
      nextRunAt: new Date(
        Date.now() + (page.nextPageToken || remaining ? 0 : 60_000),
      ),
    });
    return { processed, hasMore: !!page.nextPageToken || remaining > 0 };
  } catch {
    const failures = state.failures + 1;
    await release(emailAccountId, leaseToken, {
      failures,
      nextRunAt: new Date(
        Date.now() + Math.min(3_600_000, 60_000 * 2 ** Math.min(failures, 6)),
      ),
    });
    logger.warn("Thunderbird synchronization failed; retry scheduled", {
      failures,
    });
    return { failed: true };
  }
}

async function release(
  emailAccountId: string,
  leaseToken: string,
  data: {
    enabled?: boolean;
    failures?: number;
    lastSyncedAt?: Date;
    nextRunAt?: Date;
  },
) {
  await prisma.thunderbirdSyncState.updateMany({
    where: { emailAccountId, leaseToken },
    data: { ...data, leaseToken: null, leaseUntil: null },
  });
}
