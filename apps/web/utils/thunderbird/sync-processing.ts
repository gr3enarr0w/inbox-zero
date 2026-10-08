import { createHash } from "node:crypto";
import prisma from "@/utils/prisma";
import { runRules } from "@/utils/ai/choose-rule/run-rules";
import type { ParsedMessage } from "@/utils/types";

export async function processThunderbirdSyncMessage(
  options: Parameters<typeof runRules>[0],
  leaseToken: string,
  messageKey: string,
  pendingStatus: "queued" | "retry_ready" | "read_retry_1" | "read_retry_2",
) {
  if (!isThunderbirdReadPendingStatus(pendingStatus)) return "duplicate";
  const emailAccountId = options.emailAccount.id;
  const claim = await prisma.thunderbirdSyncMessage.updateMany({
    where: {
      emailAccountId,
      messageKey,
      status: pendingStatus,
      emailAccount: {
        thunderbirdSyncState: {
          enabled: true,
          leaseToken,
          leaseUntil: { gt: new Date() },
        },
        account: { provider: "thunderbird", disconnectedAt: null },
      },
    },
    data: { status: "claimed" },
  });
  if (!claim.count) return "duplicate";
  let status = "review_required";
  try {
    const results = await runRules(options);
    if (
      results.some(
        (result) => result.status === "ERROR" || result.status === "APPLYING",
      )
    )
      throw new Error("Thunderbird rule execution needs review");
    status = "completed";
  } catch {
    // A claimed action may have reached Thunderbird even if its response was lost.
    options.logger.warn("Thunderbird automation requires manual review");
  }
  await prisma.thunderbirdSyncMessage.updateMany({
    where: { emailAccountId, messageKey, status: "claimed" },
    data: { status, processedAt: new Date() },
  });
  return status;
}

export function getThunderbirdSyncMessageKey(
  emailAccountId: string,
  message: ParsedMessage,
) {
  const rfcId = message.headers["message-id"]?.trim();
  if (!rfcId || !Number.isFinite(new Date(message.date).getTime()))
    throw new Error("Thunderbird message has no durable identity");
  return createHash("sha256")
    .update(
      JSON.stringify([
        emailAccountId,
        rfcId,
        new Date(message.date).toISOString(),
        message.subject,
      ]),
    )
    .digest("hex");
}

export function isThunderbirdReadPendingStatus(
  status: string,
): status is "queued" | "retry_ready" | "read_retry_1" | "read_retry_2" {
  return (
    status === "queued" ||
    status === "retry_ready" ||
    status === "read_retry_1" ||
    status === "read_retry_2"
  );
}
