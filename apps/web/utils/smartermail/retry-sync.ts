import prisma from "@/utils/prisma";
import { SafeError } from "@/utils/error";

export async function retrySmarterMailSyncMessage(
  emailAccountId: string,
  messageId: string,
) {
  const state = await prisma.smarterMailSyncState.findUnique({
    where: { emailAccountId },
  });
  if (!state?.enabled || (state.leaseUntil && state.leaseUntil > new Date()))
    throw new SafeError("Wait for the current sync to finish before retrying.");
  const executed = await prisma.executedRule.count({
    where: { emailAccountId, messageId },
  });
  if (executed !== 0)
    throw new SafeError(
      "This message requires review because rule execution may have started.",
    );
  const result = await prisma.smarterMailSyncMessage.deleteMany({
    where: { emailAccountId, messageId, status: "retry_ready" },
  });
  if (!result.count)
    throw new SafeError(
      "Only failures confirmed to occur before rule execution can be retried.",
    );
  await prisma.smarterMailSyncState.updateMany({
    where: { emailAccountId, enabled: true },
    data: { cursor: null, failures: 0, nextRunAt: new Date() },
  });
  return { retried: result.count };
}
