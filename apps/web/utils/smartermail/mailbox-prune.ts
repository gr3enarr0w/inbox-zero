import prisma from "@/utils/prisma";

export async function pruneSmarterMailMailbox(
  sessionId: string,
  generation: number,
  limit: number,
  verifyExistingIds: (ids: string[]) => Promise<string[]>,
) {
  const missing = await prisma.smarterMailMailboxMessage.findMany({
    where: {
      sessionId,
      generation: { lt: generation },
      lastMissingGeneration: { lt: generation },
    },
    select: { messageId: true, missingScans: true },
    orderBy: { messageId: "asc" },
    take: limit,
  });
  const existingIds = new Set(
    await verifyExistingIds(missing.map((message) => message.messageId)),
  );
  const absent = missing.filter(
    (message) => !existingIds.has(message.messageId),
  );
  const confirmedIds = absent
    .filter((message) => message.missingScans >= 1)
    .map((message) => message.messageId);
  await prisma.smarterMailMailboxMessage.updateMany({
    where: {
      sessionId,
      messageId: { in: absent.map((message) => message.messageId) },
      lastMissingGeneration: { lt: generation },
    },
    data: { lastMissingGeneration: generation, missingScans: { increment: 1 } },
  });
  await prisma.smarterMailMailboxMessage.updateMany({
    where: {
      sessionId,
      messageId: { in: confirmedIds },
      generation: { lt: generation },
    },
    data: { removed: true },
  });
  await prisma.smarterMailMailboxMessage.updateMany({
    where: { sessionId, messageId: { in: [...existingIds] } },
    data: { generation, missingScans: 0, removed: false },
  });
  return { removedMessageIds: confirmedIds, hasMore: missing.length === limit };
}
