import { z } from "zod";
import type { ParsedMessage } from "@/utils/types";
import {
  thunderbirdIdentitySchema,
  thunderbirdMessageSchema,
  type ThunderbirdMessage,
} from "@/utils/thunderbird/types";

const referenceSchema = z.tuple([
  z.string().min(1),
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  thunderbirdIdentitySchema,
]);
export function thunderbirdMessageId(
  accountId: string,
  message: ThunderbirdMessage,
) {
  const identity = thunderbirdIdentitySchema.parse(message);
  const reference = referenceSchema.parse([accountId, message.id, identity]);
  return `tb:${Buffer.from(JSON.stringify(reference)).toString("base64url")}`;
}
export function parseThunderbirdMessageId(id: string, accountId: string) {
  if (!id.startsWith("tb:") || id.length > 20_000)
    throw new Error("Invalid Thunderbird message reference");
  const reference = referenceSchema.parse(
    JSON.parse(Buffer.from(id.slice(3), "base64url").toString("utf8")),
  );
  if (
    reference[0] !== accountId ||
    `tb:${Buffer.from(JSON.stringify(reference)).toString("base64url")}` !== id
  )
    throw new Error("Thunderbird message account scope mismatch");
  return { nativeId: reference[1], identity: reference[2] };
}
export function assertThunderbirdIdentity(
  message: ThunderbirdMessage,
  identity: z.infer<typeof thunderbirdIdentitySchema>,
) {
  if (
    message.headerMessageId !== identity.headerMessageId ||
    message.date !== identity.date ||
    message.subject !== identity.subject
  )
    throw new Error("Thunderbird message identity mismatch");
}
export function normalizeThunderbirdMessage(
  value: unknown,
  accountId: string,
  role?: string,
): ParsedMessage {
  const message = thunderbirdMessageSchema.parse(value);
  const id = thunderbirdMessageId(accountId, message);
  const labelIds = [
    message.folderId,
    ...(role ? [role] : []),
    ...(!message.read ? ["UNREAD"] : []),
    ...(message.flagged ? ["STARRED"] : []),
  ];
  const headerId = message.headerMessageId.startsWith("<")
    ? message.headerMessageId
    : `<${message.headerMessageId}>`;
  return {
    id,
    threadId: id,
    historyId: "",
    date: message.date,
    internalDate: String(Date.parse(message.date)),
    subject: message.subject,
    headers: {
      from: message.from,
      to: message.to.join(", "),
      subject: message.subject,
      date: message.date,
      "message-id": headerId,
      "in-reply-to": message.inReplyTo,
      references: message.references,
      "reply-to": message.replyTo,
    },
    textPlain: message.textPlain,
    textHtml: message.textHtml,
    snippet: (message.textPlain ?? "").replace(/\s+/g, " ").slice(0, 200),
    inline: [],
    hasAttachment: message.hasAttachments,
    parentFolderId: message.folderId,
    labelIds,
  };
}
