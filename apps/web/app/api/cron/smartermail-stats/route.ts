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
      nextRunAt: { lte: new Date() },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
      emailAccount: {
        account: { provider: "smartermail", disconnectedAt: null },
      },
    },
    orderBy: { updatedAt: "asc" },
    select: {
      emailAccountId: true,
      failures: true,
      nextRunAt: true,
      updatedAt: true,
    },
  });
  if (!state) return NextResponse.json({ due: 0 });
  let emailProvider: Awaited<ReturnType<typeof createEmailProvider>>;
  try {
    emailProvider = await createEmailProvider({
      emailAccountId: state.emailAccountId,
      provider: "smartermail",
      logger: request.logger,
    });
  } catch {
    const now = new Date();
    await prisma.smarterMailStatsImportState.updateMany({
      where: {
        emailAccountId: state.emailAccountId,
        nextRunAt: state.nextRunAt,
        updatedAt: state.updatedAt,
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
      },
      data: {
        failures: { increment: 1 },
        importError: "Statistics connection failed; retry to resume.",
        nextRunAt: new Date(
          now.getTime() +
            Math.min(3_600_000, 60_000 * 2 ** Math.min(state.failures, 6)),
        ),
        updatedAt: now,
      },
    });
    return NextResponse.json(
      { due: 1, error: "Statistics connection failed; retry to resume." },
      { status: 503 },
    );
  }
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
