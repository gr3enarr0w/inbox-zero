import { z } from "zod";
import type { ParsedMessage } from "@/utils/types";

const messageSchema = z.object({
  uid: z.number().int().positive().optional(),
  subject: z.string().optional(),
  from: z
    .union([
      z.string(),
      z.object({ email: z.string(), name: z.string().optional() }),
    ])
    .optional(),
  to: z.string().optional(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  date: z.string().optional(),
  dateSent: z.string().optional(),
  header: z.string().optional(),
  messagePlainText: z.string().optional(),
  messageHTML: z.string().optional(),
  isSeen: z.boolean().optional(),
  internalDate: z.string().optional(),
  isFlagged: z.boolean().optional(),
  categories: z.array(z.string()).optional(),
  hasAttachments: z.boolean().optional(),
});

// UIDs are only unique within their folder; moves invalidate these references.
export function smarterMailMessageId(folder: string, uid: number): string {
  if (!folder || !Number.isSafeInteger(uid) || uid <= 0) {
    throw new Error("Invalid SmarterMail message reference");
  }
  return `sm:${Buffer.from(JSON.stringify([folder, uid])).toString("base64url")}`;
}

export function parseSmarterMailMessageId(id: string): {
  folder: string;
  uid: number;
} {
  try {
    if (!id.startsWith("sm:"))
      throw new Error("Invalid SmarterMail message reference");
    const value = z
      .tuple([
        z.string().min(1),
        z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      ])
      .parse(
        JSON.parse(Buffer.from(id.slice(3), "base64url").toString("utf8")),
      );
    if (smarterMailMessageId(value[0], value[1]) !== id)
      throw new Error("Invalid SmarterMail message reference");
    return { folder: value[0], uid: value[1] };
  } catch {
    throw new Error("Invalid SmarterMail message reference");
  }
}

export function normalizeSmarterMailMessage(
  payload: unknown,
  folder: string,
  uid: number,
  summary?: unknown,
): ParsedMessage {
  const wrapper = z.object({ messageData: messageSchema }).parse(payload);
  const detail = wrapper.messageData;
  const metadata = messageSchema.parse(summary ?? {});
  const data = { ...metadata, ...detail };
  const rawHeaders = parseHeaders(data.header ?? "");
  const subject = data.subject ?? rawHeaders.subject ?? "";
  const date = rawHeaders.date ?? data.date ?? data.dateSent ?? "";
  const received = new Date(
    data.internalDate ?? data.date ?? data.dateSent ?? date,
  ).getTime();
  if (!Number.isFinite(received))
    throw new Error("SmarterMail message has an invalid date");
  const id = smarterMailMessageId(folder, uid);
  const role = smarterMailFolderRole(folder);
  const labelIds = [
    folder,
    ...(data.categories ?? []).map(smarterMailCategoryId),
  ];
  if (role) labelIds.push(role);
  if (data.isSeen === false) labelIds.push("UNREAD");
  if (data.isFlagged) labelIds.push("STARRED");
  return {
    id,
    threadId: id,
    historyId: "",
    date,
    internalDate: String(received),
    subject,
    headers: {
      ...rawHeaders,
      from:
        (typeof data.from === "string"
          ? data.from
          : data.from &&
            (data.from.name
              ? `${data.from.name} <${data.from.email}>`
              : data.from.email)) ??
        rawHeaders.from ??
        "",
      to: data.to ?? rawHeaders.to ?? "",
      cc: data.cc ?? rawHeaders.cc,
      bcc: data.bcc ?? rawHeaders.bcc,
      date,
      subject,
    },
    textPlain: data.messagePlainText,
    textHtml: data.messageHTML,
    snippet: (data.messagePlainText ?? "").replace(/\s+/g, " ").slice(0, 200),
    inline: [],
    hasAttachment: data.hasAttachments,
    parentFolderId: folder,
    labelIds: [...new Set(labelIds)],
  };
}

export function smarterMailCategoryId(name: string) {
  return `sm-category:${name}`;
}

export function smarterMailFolderRole(folder: string) {
  const roles: Record<string, string> = {
    inbox: "INBOX",
    drafts: "DRAFT",
    sent: "SENT",
    "sent items": "SENT",
    archive: "ARCHIVE",
    "deleted items": "TRASH",
    trash: "TRASH",
    "junk e-mail": "SPAM",
    "junk email": "SPAM",
    spam: "SPAM",
  };
  return roles[folder.toLowerCase()];
}

function parseHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of raw.replace(/\r?\n[\t ]+/g, " ").split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    if (!(key in headers)) headers[key] = line.slice(separator + 1).trim();
  }
  return headers;
}
