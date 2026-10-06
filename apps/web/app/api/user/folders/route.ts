import { NextResponse } from "next/server";
import { withEmailProvider } from "@/utils/middleware";
import { getEmailProviderCapabilities } from "@/utils/email/capabilities";
import type { EmailProvider } from "@/utils/email/types";

export type GetFoldersResponse = Awaited<ReturnType<typeof getFolders>>;

export const GET = withEmailProvider("user/folders", async (request) => {
  const emailProvider = request.emailProvider;

  if (!getEmailProviderCapabilities(emailProvider.name).folders) {
    return NextResponse.json(
      { error: "This email provider does not support folders" },
      { status: 400 },
    );
  }

  const result = await getFolders({ emailProvider });
  return NextResponse.json(result);
});

async function getFolders({ emailProvider }: { emailProvider: EmailProvider }) {
  const folders = await emailProvider.getFolders();
  return folders;
}
