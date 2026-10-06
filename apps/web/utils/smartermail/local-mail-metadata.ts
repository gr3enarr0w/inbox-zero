import { toLocalMailMessage } from "@/utils/email/local-mail-sync";
import { extractEmailAddresses } from "@/utils/email";
import type { ParsedMessage } from "@/utils/types";

export function smarterMailBodyMessage(message: ParsedMessage) {
  return {
    message: toLocalMailMessage(message),
    changeKey: undefined,
    hasAttachments: message.hasAttachment,
    attachmentMetadataAvailable: false as const,
  };
}

export function smarterMailMetadataPatch(message: ParsedMessage) {
  const recipient = (header: string) =>
    extractEmailAddresses(header).map((address) => ({
      emailAddress: { address },
    }));
  return {
    id: message.id,
    conversationId: message.threadId,
    internetMessageId: message.headers["message-id"],
    subject: message.subject,
    bodyPreview: message.snippet,
    from: recipient(message.headers.from)[0],
    toRecipients: recipient(message.headers.to),
    ccRecipients: recipient(message.headers.cc ?? ""),
    receivedDateTime: new Date(Number(message.internalDate)).toISOString(),
    internalDate: message.internalDate,
    isRead: !message.labelIds?.includes("UNREAD"),
    isDraft: !!message.labelIds?.includes("DRAFT"),
    flag: {
      flagStatus: message.labelIds?.includes("STARRED")
        ? ("flagged" as const)
        : ("notFlagged" as const),
    },
    parentFolderId: message.parentFolderId,
    categoryIds:
      message.labelIds?.filter((id) => id.startsWith("sm-category:")) ?? [],
    hasAttachments: message.hasAttachment,
  };
}
