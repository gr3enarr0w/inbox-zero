import { NextResponse } from "next/server";
import { withError } from "@/utils/middleware";
import { hasCronSecret } from "@/utils/cron";
import { enqueueDueSmarterMailSyncs } from "@/utils/smartermail/dispatch";

export const GET = withError("cron/smartermail-sync", async (request) => {
  if (!hasCronSecret(request))
    return new Response("Unauthorized", { status: 401 });
  return NextResponse.json(await enqueueDueSmarterMailSyncs(request.logger));
});
