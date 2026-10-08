import { z } from "zod";
import prisma from "@/utils/prisma";
import { SafeError } from "@/utils/error";
import { ThunderbirdClient } from "@/utils/thunderbird/client";
import { getThunderbirdConfig } from "@/utils/thunderbird/config";

export async function connectThunderbird(userId: string) {
  const config = getThunderbirdConfig();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!config || user?.email.toLowerCase() !== config.ownerEmail)
    throw new SafeError("Thunderbird is not configured for this user.");
  const client = new ThunderbirdClient({
    baseUrl: config.baseUrl,
    token: config.token,
  });
  let identity: Awaited<ReturnType<ThunderbirdClient["readAccount"]>>;
  try {
    identity = await client.readAccount();
  } catch {
    throw new SafeError(
      "The Thunderbird bridge is unavailable. Open Thunderbird and try again.",
    );
  }
  const native = identity.account;
  if (
    !native.ready ||
    !native.inboxFound ||
    !z.string().email().safeParse(native.email).success ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(native.id)
  )
    throw new SafeError("Thunderbird did not return a ready mailbox.");
  const email = native.email.toLowerCase();
  const existing = await prisma.emailAccount.findUnique({
    where: { email },
    include: { account: true },
  });
  if (
    existing &&
    (existing.userId !== userId ||
      existing.account.provider !== "thunderbird" ||
      existing.account.thunderbirdAccountId !== native.id)
  )
    throw new SafeError(
      "This mailbox is already connected to another account.",
    );
  const account = await prisma.account.upsert({
    where: {
      provider_providerAccountId: {
        provider: "thunderbird",
        providerAccountId: native.id,
      },
      userId,
      emailAccount: { is: { email, userId } },
    },
    create: {
      userId,
      provider: "thunderbird",
      type: "thunderbird",
      providerAccountId: native.id,
      thunderbirdAccountId: native.id,
      emailAccount: { create: { userId, email } },
    },
    update: { disconnectedAt: null },
    select: {
      emailAccount: { select: { id: true, email: true, userId: true } },
    },
  });
  if (
    !account.emailAccount ||
    account.emailAccount.userId !== userId ||
    account.emailAccount.email !== email
  )
    throw new SafeError("The Thunderbird mailbox binding does not match.");
  await prisma.thunderbirdSyncState.upsert({
    where: { emailAccountId: account.emailAccount.id },
    create: { emailAccountId: account.emailAccount.id, enabled: true },
    update: { enabled: true, nextRunAt: new Date() },
  });
  return { emailAccountId: account.emailAccount.id };
}
