import prisma from "@/utils/prisma";

export async function watchSmarterMailEmails(emailAccountId: string) {
  await prisma.smarterMailSyncState.upsert({
    where: { emailAccountId },
    create: { emailAccountId, enabled: true },
    update: { enabled: true, nextRunAt: new Date() },
  });
  // Polling has no provider subscription; renew through the existing watch manager.
  return { expirationDate: new Date(Date.now() + 24 * 60 * 60 * 1000) };
}

export async function unwatchSmarterMailEmails(emailAccountId: string) {
  await prisma.smarterMailSyncState.updateMany({
    where: { emailAccountId },
    data: { enabled: false },
  });
}
