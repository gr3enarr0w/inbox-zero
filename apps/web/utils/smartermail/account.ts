import "server-only";
import { env } from "@/env";
import prisma from "@/utils/prisma";
import { SafeError } from "@/utils/error";
import { SmarterMailClient } from "@/utils/smartermail/client";
import type { SmarterMailTokens } from "@/utils/smartermail/tokens";
import { validateSmarterMailOrigin } from "@/utils/smartermail/origin";
import { decryptToken } from "@/utils/encryption";

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
  let credentialsAccessToken = account.access_token;
  let credentialsRefreshToken = account.refresh_token;
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
      // Compare ciphertext in WHERE: randomized encryption makes plaintext token
      // predicates unusable, while unrelated metadata writes must not block refresh.
      const [stored] = await prisma.$queryRaw<
        { access_token: string | null; refresh_token: string | null }[]
      >`
        SELECT access_token, refresh_token FROM "Account"
        WHERE id = ${account.id} AND "userId" = ${account.userId}
          AND "smarterMailBaseUrl" = ${account.smarterMailBaseUrl}
          AND provider = 'smartermail' AND "disconnectedAt" IS NULL
      `;
      if (
        !stored ||
        decryptToken(stored.access_token) !== credentialsAccessToken ||
        decryptToken(stored.refresh_token) !== credentialsRefreshToken
      ) {
        throw new SafeError(
          "SmarterMail credentials changed. Please retry the request.",
        );
      }
      const result = await prisma.account.updateMany({
        where: {
          id: account.id,
          userId: account.userId,
          provider: "smartermail",
          disconnectedAt: null,
          smarterMailBaseUrl: account.smarterMailBaseUrl,
          access_token: stored.access_token,
          refresh_token: stored.refresh_token,
        },
        data: smarterMailTokenData(tokens),
      });
      if (result.count !== 1)
        throw new SafeError(
          "SmarterMail credentials changed. Please retry the request.",
        );
      credentialsAccessToken = tokens.accessToken;
      credentialsRefreshToken = tokens.refreshToken;
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
