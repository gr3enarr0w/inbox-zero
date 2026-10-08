import { NextResponse } from "next/server";
import prisma from "@/utils/prisma";
import { withAuth } from "@/utils/middleware";
import { isThunderbirdOwner } from "@/utils/thunderbird/config";

export const GET = withAuth("user/thunderbird-connection", async (request) => {
  const user = await prisma.user.findUnique({
    where: { id: request.auth.userId },
    select: { email: true },
  });
  return NextResponse.json({ enabled: isThunderbirdOwner(user?.email) });
});
