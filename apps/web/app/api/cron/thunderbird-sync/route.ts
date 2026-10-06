import { NextResponse } from "next/server";
import prisma from "@/utils/prisma";
import { withError } from "@/utils/middleware";
import { hasCronSecret } from "@/utils/cron";
import { syncThunderbirdAccount } from "@/utils/thunderbird/sync";

export const maxDuration = 300;
export const GET = withError("cron/thunderbird-sync", async (request) => {
  if (!hasCronSecret(request))
    return new Response("Unauthorized", { status: 401 });
  const now = new Date();
  const state = await prisma.thunderbirdSyncState.findFirst({
    where: {
      enabled: true,
      nextRunAt: { lte: now },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
      emailAccount: {
        account: { provider: "thunderbird", disconnectedAt: null },
      },
    },
    orderBy: { nextRunAt: "asc" },
    select: { emailAccountId: true },
  });
  if (!state) return NextResponse.json({ due: 0 });
  return NextResponse.json({
    due: 1,
    result: await syncThunderbirdAccount(state.emailAccountId, request.logger),
  });
});
