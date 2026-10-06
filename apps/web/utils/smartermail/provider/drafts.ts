import { normalizeSmarterMailMessage } from "@/utils/smartermail/message";
import {
  smarterMailDraftId,
  smarterMailDraftMid,
  currentDraftUid,
} from "@/utils/smartermail/provider/draft-reference";
import type { EmailProvider } from "@/utils/email/types";
import type { ParsedMessage } from "@/utils/types";
import { parseSmarterMailMessageId } from "@/utils/smartermail/message";

import { SmarterMailMutationsProvider } from "@/utils/smartermail/provider/mutations";
import { rejectAttachments } from "@/utils/smartermail/provider/helpers";

export class SmarterMailDraftsProvider extends SmarterMailMutationsProvider {
  async createDraft(
    params: Parameters<EmailProvider["createDraft"]>[0] & {
      cc?: string;
      bcc?: string;
    },
  ) {
    const reply = params.replyToMessageId
      ? parseSmarterMailMessageId(params.replyToMessageId)
      : undefined;
    const folder = await this.systemFolder("DRAFT");
    const result = await this.client.request("saveDraft", {
      folder,
      to: params.to,
      cc: params.cc,
      bcc: params.bcc,
      subject: params.subject,
      messageHTML: params.messageHtml,
      ...(reply
        ? { isReply: true, replyUid: reply.uid, replyFromFolder: reply.folder }
        : {}),
    });
    return { id: smarterMailDraftId(result) };
  }
  async draftEmail(
    email: ParsedMessage,
    args: Parameters<EmailProvider["draftEmail"]>[1],
  ) {
    rejectAttachments(args.attachments);
    const result = await this.createDraft({
      to: args.to ?? email.headers["reply-to"] ?? email.headers.from,
      subject: args.subject ?? `Re: ${email.subject}`,
      cc: args.cc,
      bcc: args.bcc,
      messageHtml: args.content,
      replyToMessageId: email.id,
    });
    return { draftId: result.id };
  }
  async getDraftReferenceForMessage(messageId: string) {
    if (messageId.startsWith("sm-draft:")) {
      smarterMailDraftMid(messageId);
      return { id: messageId };
    }
    const reference = parseSmarterMailMessageId(messageId);
    const folder = await this.systemFolder("DRAFT");
    if (reference.folder !== folder) return null;
    const payload = await this.client.request("message", reference);
    currentDraftUid(payload, folder, reference);
    return {
      id: smarterMailDraftId({
        mid: (payload as { messageData?: { mid?: unknown } }).messageData?.mid,
      }),
    };
  }
  async getDraft(id: string) {
    const folder = await this.systemFolder("DRAFT");
    const reference = id.startsWith("sm-draft:")
      ? { folder, mid: smarterMailDraftMid(id) }
      : parseSmarterMailMessageId(id);
    if (reference.folder !== folder)
      throw new Error("Message is not a SmarterMail draft");
    const payload = await this.client.request("message", reference);
    return normalizeSmarterMailMessage(
      payload,
      folder,
      currentDraftUid(payload, folder, reference),
    );
  }
  async deleteDraft(id: string) {
    const draft = await this.getDraft(id);
    const reference = parseSmarterMailMessageId(draft.id);
    await this.client.request("deleteMessages", {
      folder: reference.folder,
      uID: [reference.uid],
      all: false,
      moveToDeleted: false,
    });
    return true;
  }
  async updateDraft(
    id: string,
    params: Parameters<EmailProvider["updateDraft"]>[1],
  ) {
    rejectAttachments(params.attachments);
    const draft = await this.getDraft(id);
    const reference = parseSmarterMailMessageId(draft.id);
    await this.client.request("saveDraft", {
      draftUid: reference.uid,
      folder: reference.folder,
      to: params.to ?? draft.headers.to,
      cc: params.cc ?? draft.headers.cc,
      bcc: params.bcc ?? draft.headers.bcc,
      subject: params.subject ?? draft.subject,
      messageHTML: params.messageHtml ?? draft.textHtml,
      messagePlainText:
        params.messageHtml !== undefined ? undefined : draft.textPlain,
    });
  }
}
