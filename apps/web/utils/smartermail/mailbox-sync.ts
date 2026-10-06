import prisma from "@/utils/prisma";
import { compactMailboxSyncMessage } from "@/utils/email/mailbox-sync";
import type { EmailProvider, MailboxSyncPage } from "@/utils/email/types";
import {
  getSmarterMailMailboxSession,
  encodeSmarterMailMailboxCursor,
} from "@/utils/smartermail/mailbox-session";
import { pruneSmarterMailMailbox } from "@/utils/smartermail/mailbox-prune";

export async function getSmarterMailMailboxSyncPage({
  emailAccountId,
  provider,
  cursor,
  after,
  folderId = "Inbox",
  limit,
  verifyExistingIds,
}: {
  emailAccountId: string;
  provider: Pick<EmailProvider, "getMessagesWithPagination">;
  cursor?: string;
  after?: Date;
  folderId?: string;
  limit: number;
  verifyExistingIds: (folderId: string, ids: string[]) => Promise<string[]>;
}): Promise<MailboxSyncPage> {
  const take = Math.max(1, Math.min(100, limit));
  let { decoded, session, recovered } = await getSmarterMailMailboxSession({
    emailAccountId,
    folderId,
    cursor,
    after,
  });
  if (decoded.phase === "prune") {
    const pruned = await pruneSmarterMailMailbox(
      session.id,
      decoded.generation,
      take,
      (ids) => verifyExistingIds(folderId, ids),
    );
    if (!pruned.hasMore) {
      await prisma.smarterMailMailboxSession.updateMany({
        where: { id: session.id, generation: decoded.generation },
        data: { generation: { increment: 1 } },
      });
      decoded = {
        sessionId: session.id,
        generation: decoded.generation + 1,
        phase: "scan",
      };
    }
    return {
      cursor: encodeSmarterMailMailboxCursor(decoded),
      deletedMessageIds: [],
      ...pruned,
      reset: false,
      upsertedMessages: [],
    };
  }
  const page = await provider.getMessagesWithPagination({
    folderId,
    maxResults: take,
    pageToken: decoded.pageToken,
  });
  const messages = page.messages.filter(
    (message) =>
      new Date(
        message.internalDate ? Number(message.internalDate) : message.date,
      ) >= session.after,
  );
  await prisma.$transaction(
    messages.map((message) =>
      prisma.smarterMailMailboxMessage.upsert({
        where: {
          sessionId_messageId: { sessionId: session.id, messageId: message.id },
        },
        create: {
          sessionId: session.id,
          messageId: message.id,
          generation: decoded.generation,
        },
        update: {
          generation: decoded.generation,
          missingScans: 0,
          removed: false,
        },
      }),
    ),
  );
  await prisma.smarterMailMailboxSession.update({
    where: { id: session.id },
    data: { updatedAt: new Date() },
  });
  decoded = page.nextPageToken
    ? { ...decoded, pageToken: page.nextPageToken }
    : { sessionId: session.id, generation: decoded.generation, phase: "prune" };
  return {
    cursor: encodeSmarterMailMailboxCursor(decoded),
    deletedMessageIds: [],
    hasMore: true,
    reset: !cursor || recovered,
    upsertedMessages: messages.map(compactMailboxSyncMessage),
  };
}
