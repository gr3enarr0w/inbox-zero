import prisma from "@/utils/prisma";
import { canonicalizeEmailAddress, extractNameFromEmail } from "@/utils/email";
import type { ParsedMessage } from "@/utils/types";

export async function hydrateImportedSenders({
  emailAccountId,
  messages,
}: {
  emailAccountId: string;
  messages: ParsedMessage[];
}) {
  if (messages.length > 25)
    throw new Error("Sender import page exceeds 25 messages");
  const account = await prisma.emailAccount.findUniqueOrThrow({
    where: { id: emailAccountId },
    select: { email: true },
  });
  const owner = canonicalizeEmailAddress(account.email);
  const senders = new Map<string, string | null>();
  for (const message of messages) {
    if (
      message.labelIds?.includes("SENT") ||
      message.labelIds?.includes("DRAFT")
    )
      continue;
    const email = canonicalizeEmailAddress(message.headers.from);
    if (!email || email === owner) continue;
    const fromName = extractNameFromEmail(message.headers.from);
    const name =
      canonicalizeEmailAddress(fromName) === email ? null : fromName || null;
    if (!senders.has(email) || !senders.get(email)) senders.set(email, name);
  }
  if (!senders.size) return { created: 0 };
  const existing = await prisma.newsletter.findMany({
    where: {
      emailAccountId,
      email: { in: [...senders.keys()], mode: "insensitive" },
    },
    select: { email: true },
  });
  for (const sender of existing) senders.delete(sender.email.toLowerCase());
  if (!senders.size) return { created: 0 };
  // Message labels do not establish a sender-wide category; leave categorization explicit.
  const result = await prisma.newsletter.createMany({
    data: [...senders].map(([email, name]) => ({
      emailAccountId,
      email,
      name,
    })),
    skipDuplicates: true,
  });
  return { created: result.count };
}
