import "server-only";
import { env } from "@/env";
import prisma from "@/utils/prisma";
import { SafeError } from "@/utils/error";
import { SmarterMailClient } from "@/utils/smartermail/client";
import type { SmarterMailTokens } from "@/utils/smartermail/tokens";
import { validateSmarterMailOrigin } from "@/utils/smartermail/origin";

export async function getSmarterMailClientForEmail({
  emailAccountId,
  userId,
}: {
  emailAccountId: string;
  userId?: string;
}) {
  const emailAccount = await prisma.emailAccount.findFirst({
    where: {
      id: emailAccountId,
      ...(userId ? { userId } : {}),
      account: { provider: "smartermail", disconnectedAt: null },
    },
    include: { account: true },
  });
  const account = emailAccount?.account;
  if (
    !account?.smarterMailBaseUrl ||
    !account.access_token ||
    !account.refresh_token
  ) {
    throw new SafeError(
      "SmarterMail account is disconnected. Connect it again from Accounts.",
    );
  }
  let credentialsUpdatedAt = account.updatedAt;
  return new SmarterMailClient({
    baseUrl: validateSmarterMailOrigin(
      account.smarterMailBaseUrl,
      env.SMARTERMAIL_ALLOWED_ORIGINS,
    ),
    tokens: {
      accessToken: account.access_token,
      refreshToken: account.refresh_token,
      expiresAt: account.expires_at?.getTime(),
    },
    onTokensChanged: async (tokens) => {
      const updatedAt = new Date(
        Math.max(Date.now(), credentialsUpdatedAt.getTime() + 1),
      );
      const result = await prisma.account.updateMany({
        where: {
          id: account.id,
          userId: account.userId,
          provider: "smartermail",
          disconnectedAt: null,
          updatedAt: credentialsUpdatedAt,
        },
        data: { ...smarterMailTokenData(tokens), updatedAt },
      });
      if (result.count !== 1)
        throw new SafeError(
          "SmarterMail credentials changed. Please retry the request.",
        );
      credentialsUpdatedAt = updatedAt;
    },
  });
}

export function smarterMailTokenData(tokens: SmarterMailTokens) {
  return {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_at: tokens.expiresAt ? new Date(tokens.expiresAt) : null,
  };
}
