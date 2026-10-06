import { NextResponse } from "next/server";
import prisma from "@/utils/prisma";
import { withEmailAccount } from "@/utils/middleware";

export const GET = withEmailAccount(
  "user/smartermail-sync-status",
  async (request) =>
    NextResponse.json(await getData(request.auth.emailAccountId)),
);

async function getData(emailAccountId: string) {
  const [state, reviewRequired] = await Promise.all([
    prisma.smarterMailSyncState.findUnique({
      where: { emailAccountId },
      select: {
        enabled: true,
        failures: true,
        nextRunAt: true,
        lastSyncedAt: true,
        leaseUntil: true,
      },
    }),
    prisma.smarterMailSyncMessage.findMany({
      where: {
        emailAccountId,
        status: { in: ["claimed", "review_required", "retry_ready"] },
      },
      select: {
        messageId: true,
        status: true,
        createdAt: true,
        processedAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  return { state, reviewRequired };
}

export type SmarterMailSyncStatusResponse = Awaited<ReturnType<typeof getData>>;
