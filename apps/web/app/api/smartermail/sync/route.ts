import { NextResponse } from "next/server";
import { z } from "zod";
import { withError } from "@/utils/middleware";
import { isValidInternalApiKey } from "@/utils/internal-api";
import { syncSmarterMailAccount } from "@/utils/smartermail/sync";

const bodySchema = z.object({ emailAccountId: z.string().min(1) });

export const maxDuration = 300;

export const POST = withError("smartermail/sync", async (request) => {
  if (!isValidInternalApiKey(request.headers, request.logger))
    return new Response("Unauthorized", { status: 401 });
  const body = bodySchema.safeParse(await request.json());
  if (!body.success)
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  return NextResponse.json(
    await syncSmarterMailAccount(
      body.data.emailAccountId,
      request.logger.with({ emailAccountId: body.data.emailAccountId }),
    ),
  );
});
