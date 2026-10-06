import prisma from "@/utils/prisma";
import { SafeError } from "@/utils/error";
import { getEnabledLoginProviders } from "@/utils/oauth/login-providers";

export async function getMailboxDeletionLoginGuard(
  userId: string,
  accountId: string,
) {
  const remainingNativeMailbox = await prisma.account.count({
    where: {
      userId,
      provider: { in: ["smartermail", "thunderbird"] },
      id: { not: accountId },
    },
  });
  if (!remainingNativeMailbox) return {};
  const loginProviders = Array.from(getEnabledLoginProviders());
  const user = {
    OR: [
      { emailOtpEnabled: true },
      {
        accounts: {
          some: { id: { not: accountId }, provider: { in: loginProviders } },
        },
      },
    ],
  };
  const canSignIn = await prisma.user.findFirst({
    where: { id: userId, ...user },
    select: { id: true },
  });
  if (!canSignIn) {
    throw new SafeError(
      "Connect another sign-in account or enable email code sign-in before deleting this mailbox.",
    );
  }
  // Recheck inside the existing locked transaction so simultaneous deletions cannot remove every login.
  return { user };
}

export function userLoginLock(userId: string) {
  return prisma.$queryRaw`
    SELECT true AS locked
    FROM (SELECT pg_advisory_xact_lock(539114481, hashtext(${userId}))) lock
  `;
}
