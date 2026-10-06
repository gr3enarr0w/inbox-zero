import { SmarterMailUnsupportedError } from "@/utils/smartermail/provider/error";
import { z } from "zod";
import type { EmailThread } from "@/utils/email/types";
import type { ParsedMessage } from "@/utils/types";
import { smarterMailMessageId } from "@/utils/smartermail/message";

export function toThread(message: ParsedMessage): EmailThread {
  return {
    id: message.threadId,
    messages: [message],
    snippet: message.snippet,
  };
}
export function parsePageToken(token?: string) {
  if (token === undefined) return 0;
  if (!/^(0|[1-9]\d*)$/.test(token) || !Number.isSafeInteger(Number(token)))
    throw new Error("Invalid SmarterMail page token");
  return Number(token);
}
export function categoryName(id: string) {
  if (!id.startsWith("sm-category:") || id.length === 12)
    throw new Error("Invalid SmarterMail category reference");
  return id.slice(12);
}
export function roleFromMailbox(mailbox: string) {
  const roles: Record<string, string> = {
    inbox: "INBOX",
    sent: "SENT",
    drafts: "DRAFT",
    spam: "SPAM",
    trash: "TRASH",
    archive: "ARCHIVE",
  };
  const role = roles[mailbox];
  if (!role) throw new SmarterMailUnsupportedError(`mailbox ${mailbox}`);
  return role;
}
export function responseMessageId(payload: unknown, folder: string) {
  const result = z
    .object({ uid: z.number().int().positive() })
    .safeParse(payload);
  if (!result.success)
    throw new Error(
      "SmarterMail accepted the operation but returned no message UID; do not retry automatically",
    );
  return smarterMailMessageId(folder, result.data.uid);
}
export function rejectAttachments(attachments?: readonly unknown[]) {
  if (attachments?.length)
    throw new SmarterMailUnsupportedError("attachment uploads");
}
