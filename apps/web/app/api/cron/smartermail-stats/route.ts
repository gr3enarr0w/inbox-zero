import { NextResponse } from "next/server";
import prisma from "@/utils/prisma";
import { withError } from "@/utils/middleware";
import { hasCronSecret } from "@/utils/cron";
import { createEmailProvider } from "@/utils/email/provider";
import { loadEmails } from "@/utils/actions/stats-loading";

export const maxDuration = 300;
export const GET = withError("cron/smartermail-stats", async (request) => {
  if (!hasCronSecret(request))
    return new Response("Unauthorized", { status: 401 });
  const state = await prisma.smarterMailStatsImportState.findFirst({
    where: {
      completedAt: null,
      nextRunAt: { lte: new Date() },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
      emailAccount: {
        account: { provider: "smartermail", disconnectedAt: null },
      },
    },
    orderBy: { updatedAt: "asc" },
    select: { emailAccountId: true },
  });
  if (!state) return NextResponse.json({ due: 0 });
  const emailProvider = await createEmailProvider({
    emailAccountId: state.emailAccountId,
    provider: "smartermail",
    logger: request.logger,
  });
  const result = await loadEmails(
    {
      emailAccountId: state.emailAccountId,
      emailProvider,
      logger: request.logger,
    },
    { loadBefore: false, maxPages: 1 },
  );
  return NextResponse.json({ due: 1, result });
});
