import prisma from "@/utils/prisma";

export async function watchThunderbirdEmails(emailAccountId: string) {
  const account = await prisma.emailAccount.findFirst({
    where: {
      id: emailAccountId,
      account: { provider: "thunderbird", disconnectedAt: null },
    },
    select: { id: true },
  });
  if (!account) return null;
  await prisma.thunderbirdSyncState.upsert({
    where: { emailAccountId },
    create: { emailAccountId, enabled: true },
    update: { enabled: true, nextRunAt: new Date() },
  });
  return { expirationDate: new Date(Date.now() + 24 * 60 * 60_000) };
}

export async function unwatchThunderbirdEmails(emailAccountId: string) {
  await prisma.thunderbirdSyncState.updateMany({
    where: { emailAccountId },
    data: { enabled: false, leaseToken: null, leaseUntil: null },
  });
}
