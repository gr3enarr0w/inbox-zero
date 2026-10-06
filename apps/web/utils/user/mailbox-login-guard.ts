import prisma from "@/utils/prisma";
import { SafeError } from "@/utils/error";
import { getEnabledLoginProviders } from "@/utils/oauth/login-providers";

export async function getMailboxDeletionLoginGuard(
  userId: string,
  accountId: string,
) {
  const remainingSmarterMail = await prisma.account.count({
    where: { userId, provider: "smartermail", id: { not: accountId } },
  });
  if (!remainingSmarterMail) return {};
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
