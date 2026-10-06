import { randomUUID } from "node:crypto";
import { z } from "zod";
import prisma from "@/utils/prisma";
import type { SmarterMailMailboxSession } from "@/generated/prisma/client";
import { InvalidMailboxSyncCursorError } from "@/utils/email/mailbox-sync";

const cursorSchema = z.object({
  sessionId: z.string().uuid(),
  generation: z.number().int().positive(),
  phase: z.enum(["scan", "prune"]),
  pageToken: z.string().regex(/^\d+$/).optional(),
});

export async function getSmarterMailMailboxSession({
  emailAccountId,
  folderId,
  cursor,
  after,
}: {
  emailAccountId: string;
  folderId: string;
  cursor?: string;
  after?: Date;
}) {
  let decoded: z.infer<typeof cursorSchema>;
  let session: SmarterMailMailboxSession | null;
  let recovered = false;
  if (cursor) {
    const parsed = cursorSchema.safeParse(parseCursor(cursor));
    if (!parsed.success) throw new InvalidMailboxSyncCursorError();
    decoded = parsed.data;
    session = await prisma.smarterMailMailboxSession.findFirst({
      where: {
        id: decoded.sessionId,
        emailAccountId,
        folderId,
      },
    });
    if (!session || decoded.generation > session.generation)
      throw new InvalidMailboxSyncCursorError();
    if (decoded.generation < session.generation) {
      decoded = {
        sessionId: session.id,
        generation: session.generation,
        phase: "scan",
      };
      recovered = true;
    }
  } else {
    if (!after || !Number.isFinite(after.getTime()))
      throw new InvalidMailboxSyncCursorError();
    await prisma.smarterMailMailboxSession.deleteMany({
      where: {
        emailAccountId,
        updatedAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60_000) },
      },
    });
    const count = await prisma.smarterMailMailboxSession.count({
      where: { emailAccountId, folderId },
    });
    if (count >= 20)
      throw new Error("Too many mailbox sync sessions; reuse a cursor");
    session = await prisma.smarterMailMailboxSession.create({
      data: { id: randomUUID(), emailAccountId, folderId, after },
    });
    decoded = { sessionId: session.id, generation: 1, phase: "scan" };
  }
  return { decoded, session, recovered };
}

export function encodeSmarterMailMailboxCursor(
  value: z.infer<typeof cursorSchema>,
) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function parseCursor(cursor: string) {
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
