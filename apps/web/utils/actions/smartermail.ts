"use server";

import { env } from "@/env";
import prisma from "@/utils/prisma";
import { actionClientUser } from "@/utils/actions/safe-action";
import { connectSmarterMailBody } from "@/utils/actions/smartermail.validation";
import { SafeError } from "@/utils/error";
import {
  SmarterMailApiError,
  SmarterMailMfaRequiredError,
} from "@/utils/smartermail/errors";
import { SmarterMailClient } from "@/utils/smartermail/client";
import type { SmarterMailTokens } from "@/utils/smartermail/tokens";
import { validateSmarterMailOrigin } from "@/utils/smartermail/origin";
import { smarterMailTokenData } from "@/utils/smartermail/account";
import { clearAccountDisconnectedErrorIfResolved } from "@/utils/error-messages";
import { watchSmarterMailEmails } from "@/utils/smartermail/watch";

export const connectSmarterMailAction = actionClientUser
  .metadata({ name: "connectSmarterMail" })
  .inputSchema(connectSmarterMailBody)
  .action(async ({ ctx: { userId, logger }, parsedInput }) => {
    const baseUrl = validateSmarterMailOrigin(
      parsedInput.baseUrl,
      env.SMARTERMAIL_ALLOWED_ORIGINS,
    );
    if (!env.EMAIL_ENCRYPT_SECRET || !env.EMAIL_ENCRYPT_SALT)
      throw new SafeError(
        "Account encryption must be configured before connecting SmarterMail.",
      );
    const existing = await prisma.emailAccount.findUnique({
      where: { email: parsedInput.username },
      include: { account: true },
    });
    if (
      existing &&
      (existing.userId !== userId ||
        existing.account.provider !== "smartermail" ||
        existing.account.smarterMailBaseUrl !== baseUrl)
    ) {
      throw new SafeError(
        "This mailbox is already connected to another account or server.",
      );
    }
    let authenticatedTokens: SmarterMailTokens | undefined;
    const client = new SmarterMailClient({
      baseUrl,
      onTokensChanged: (tokens) => {
        authenticatedTokens = tokens;
      },
    });
    try {
      await client.authenticate({
        username: parsedInput.username,
        password: parsedInput.password,
      });
    } catch (error) {
      if (error instanceof SmarterMailMfaRequiredError) {
        if (!parsedInput.twoFactorCode) return { mfaRequired: true as const };
        try {
          await client.completeMfa(parsedInput.twoFactorCode);
        } catch {
          throw new SafeError(
            "SmarterMail could not verify the authentication code.",
          );
        }
      } else if (error instanceof SmarterMailApiError) {
        throw new SafeError(
          "SmarterMail sign-in failed. Check your server and credentials.",
        );
      } else {
        throw new SafeError("Could not connect to SmarterMail.");
      }
    }
    if (!authenticatedTokens)
      throw new SafeError("SmarterMail did not return account credentials.");
    const providerAccountId = `${baseUrl}|${parsedInput.username}`;
    const account = await prisma.account.upsert({
      where: {
        provider_providerAccountId: {
          provider: "smartermail",
          providerAccountId,
        },
        userId,
      },
      create: {
        userId,
        provider: "smartermail",
        type: "smartermail",
        providerAccountId,
        smarterMailBaseUrl: baseUrl,
        ...smarterMailTokenData(authenticatedTokens),
        emailAccount: { create: { userId, email: parsedInput.username } },
      },
      update: {
        ...smarterMailTokenData(authenticatedTokens),
        disconnectedAt: null,
      },
      select: { emailAccount: { select: { id: true } } },
    });
    if (!account.emailAccount)
      throw new SafeError("The connected mailbox could not be found.");
    await clearAccountDisconnectedErrorIfResolved({ userId, logger });
    await watchSmarterMailEmails(account.emailAccount.id);
    return {
      mfaRequired: false as const,
      emailAccountId: account.emailAccount.id,
    };
  });
