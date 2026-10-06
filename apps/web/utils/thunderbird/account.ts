import prisma from "@/utils/prisma";
import { SafeError } from "@/utils/error";
import { ThunderbirdClient } from "@/utils/thunderbird/client";
import { getThunderbirdConfig } from "@/utils/thunderbird/config";

export async function getThunderbirdClientForEmail({
  emailAccountId,
  userId,
}: {
  emailAccountId: string;
  userId?: string;
}) {
  const config = getThunderbirdConfig();
  const emailAccount = await prisma.emailAccount.findFirst({
    where: { id: emailAccountId, ...(userId ? { userId } : {}) },
    include: { account: true, user: { select: { email: true } } },
  });
  if (
    !config ||
    !emailAccount ||
    emailAccount.user.email.toLowerCase() !== config.ownerEmail ||
    emailAccount.account.provider !== "thunderbird" ||
    !emailAccount.account.thunderbirdAccountId ||
    emailAccount.account.disconnectedAt ||
    emailAccount.account.userId !== emailAccount.userId
  )
    throw new SafeError("This Thunderbird mailbox is not available.");
  const client = new ThunderbirdClient({
    baseUrl: config.baseUrl,
    token: config.token,
    accountId: emailAccount.account.thunderbirdAccountId,
    expectedEmail: emailAccount.email,
  });
  const { account } = await client.readAccount();
  if (!account.ready || !account.inboxFound)
    throw new SafeError("The Thunderbird mailbox is not ready.");
  return client;
}
