import { isTransactionalEmailConfigured } from "@inboxzero/transactional-email/src/delivery";
import prisma from "@/utils/prisma";
import { SafeError } from "@/utils/error";
import { getEnabledLoginProviders } from "@/utils/oauth/login-providers";
import { userLoginLock } from "@/utils/user/mailbox-login-guard";
import { isNotFoundError } from "@/utils/prisma-helpers";

const LAST_SIGN_IN_METHOD_ERROR =
  "Connect a sign-in provider before disabling email code access.";

export async function updateEmailOtpSetting({
  userId,
  sessionId,
  enabled,
}: {
  userId: string;
  sessionId: string | undefined;
  enabled: boolean;
}) {
  const session = sessionId
    ? await prisma.session.findFirst({
        where: { id: sessionId, userId, expires: { gt: new Date() } },
        select: { emailOtp: true },
      })
    : null;
  if (!session || session.emailOtp) {
    throw new SafeError(
      "Sign in with your connected provider to change email code access.",
    );
  }
  if (enabled && !isTransactionalEmailConfigured()) {
    throw new SafeError(
      "Email delivery is not configured. Contact your administrator.",
    );
  }
  const remainingLoginAccount = {
    provider: { in: Array.from(getEnabledLoginProviders()) },
  };
  if (
    !enabled &&
    !(await prisma.account.count({
      where: { userId, ...remainingLoginAccount },
    }))
  ) {
    throw new SafeError(LAST_SIGN_IN_METHOD_ERROR);
  }
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true },
  });
  // Version changes also invalidate sessions inserted after the revocation delete.
  try {
    await prisma.$transaction([
      userLoginLock(userId),
      prisma.user.update({
        where: {
          id: userId,
          email: user.email,
          ...(!enabled ? { accounts: { some: remainingLoginAccount } } : {}),
        },
        data: {
          emailOtpEnabled: enabled,
          emailOtpVersion: { increment: 1 },
          ...(enabled ? { email: user.email.trim().toLowerCase() } : {}),
        },
      }),
      // Clear pending codes on either transition so re-enabling cannot revive one.
      prisma.verificationToken.deleteMany({
        where: { identifier: `sign-in-otp-${user.email.trim().toLowerCase()}` },
      }),
      ...(!enabled
        ? [prisma.session.deleteMany({ where: { userId, emailOtp: true } })]
        : []),
    ]);
  } catch (error) {
    if (isNotFoundError(error))
      throw new SafeError(
        !enabled
          ? LAST_SIGN_IN_METHOD_ERROR
          : "Your account changed. Please retry.",
      );
    throw error;
  }
  return { enabled };
}
