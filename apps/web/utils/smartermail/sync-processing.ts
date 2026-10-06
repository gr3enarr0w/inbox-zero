import { createHash } from "node:crypto";
import prisma from "@/utils/prisma";
import { runRules } from "@/utils/ai/choose-rule/run-rules";
import { isDuplicateError } from "@/utils/prisma-helpers";
import type { ParsedMessage } from "@/utils/types";

export async function processSmarterMailMessage(
  options: Parameters<typeof runRules>[0],
) {
  const { message, emailAccount, logger } = options;
  const emailAccountId = emailAccount.id;
  const messageKey = getSmarterMailSyncMessageKey(message);
  try {
    await prisma.smarterMailSyncMessage.create({
      data: { emailAccountId, messageKey, messageId: message.id },
    });
  } catch (error) {
    if (isDuplicateError(error)) return "duplicate";
    throw error;
  }
  try {
    const results = await runRules(options);
    if (
      results.some(
        (result) => result.status === "ERROR" || result.status === "APPLYING",
      )
    )
      throw new Error("Rule processing needs review");
    await prisma.smarterMailSyncMessage.update({
      where: { emailAccountId_messageKey: { emailAccountId, messageKey } },
      data: { status: "completed", processedAt: new Date() },
    });
    return "completed";
  } catch {
    // Rule execution persists a record before performing external actions.
    let status = "review_required";
    try {
      const count = await prisma.executedRule.count({
        where: { emailAccountId, messageId: message.id },
      });
      if (count === 0) status = "retry_ready";
    } catch {
      // Database uncertainty cannot establish that actions have not started.
    }
    await prisma.smarterMailSyncMessage.update({
      where: { emailAccountId_messageKey: { emailAccountId, messageKey } },
      data: { status, processedAt: new Date() },
    });
    logger.warn("SmarterMail automation needs review", {
      messageId: message.id,
    });
    return status;
  }
}

export function getSmarterMailSyncMessageKey(message: ParsedMessage) {
  const rfcMessageId = message.headers["message-id"]?.trim();
  return createHash("sha256")
    .update(rfcMessageId ? `rfc:${rfcMessageId}` : `uid:${message.id}`)
    .digest("hex");
}
