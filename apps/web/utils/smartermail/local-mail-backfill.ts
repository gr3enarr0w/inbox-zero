import { z } from "zod";
import type { EmailProvider } from "@/utils/email/types";
import type { LocalMailSyncRequest } from "@/utils/actions/local-mail-sync.validation";
import { toLocalMailMessage } from "@/utils/email/local-mail-sync";
import { InvalidMailboxSyncCursorError } from "@/utils/email/mailbox-sync";

const cursorSchema = z.object({
  emailAccountId: z.string(),
  folderId: z.string(),
  after: z.number(),
  before: z.number(),
  offset: z.string().regex(/^\d+$/),
});

export async function getSmarterMailLocalBackfill(
  emailAccountId: string,
  provider: EmailProvider,
  request: Extract<LocalMailSyncRequest, { phase: "folder-backfill" }>,
) {
  let pageToken: string | undefined;
  if (request.cursor) {
    let parsed: z.infer<typeof cursorSchema>;
    try {
      parsed = cursorSchema.parse(
        JSON.parse(Buffer.from(request.cursor, "base64url").toString("utf8")),
      );
    } catch {
      throw new InvalidMailboxSyncCursorError();
    }
    if (
      parsed.emailAccountId !== emailAccountId ||
      parsed.folderId !== request.folderId ||
      parsed.after !== request.after ||
      parsed.before !== request.before
    )
      throw new InvalidMailboxSyncCursorError();
    pageToken = parsed.offset;
  }
  const page = await provider.getMessagesWithPagination({
    folderId: request.folderId,
    maxResults: request.limit,
    pageToken,
  });
  return {
    resetRequired: false as const,
    messages: page.messages
      .filter((message) => {
        const time = Number(message.internalDate);
        return time >= request.after && time < request.before;
      })
      .map((message) => ({
        message: toLocalMailMessage(message),
        changeKey: undefined,
        hasAttachments: message.hasAttachment,
        attachmentMetadataAvailable: false as const,
      })),
    nextCursor: page.nextPageToken
      ? Buffer.from(
          JSON.stringify({
            emailAccountId,
            folderId: request.folderId,
            after: request.after,
            before: request.before,
            offset: page.nextPageToken,
          }),
        ).toString("base64url")
      : undefined,
  };
}
