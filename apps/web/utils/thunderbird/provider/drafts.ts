import { z } from "zod";
import { convert } from "html-to-text";
import type { EmailProvider } from "@/utils/email/types";
import {
  extractEmailAddresses,
  extractEmailAddress,
  isValidEmail,
} from "@/utils/email";
import { ThunderbirdMutationsProvider } from "@/utils/thunderbird/provider/mutations";
import {
  thunderbirdIdentitySchema,
  thunderbirdMessageSchema,
} from "@/utils/thunderbird/types";
import { thunderbirdMessageId } from "@/utils/thunderbird/message";
import { ThunderbirdUnsupportedError } from "@/utils/thunderbird/errors";
export class ThunderbirdDraftsProvider extends ThunderbirdMutationsProvider {
  async createDraft(params: Parameters<EmailProvider["createDraft"]>[0]) {
    const to = extractEmailAddresses(params.to);
    if (!to.length || to.some((address) => !isValidEmail(address)))
      throw new Error("Invalid Thunderbird draft recipients");
    const draftFolder = await this.systemFolder("DRAFT");
    const textPlain = convert(params.messageHtml, {
      wordwrap: false,
      selectors: [{ selector: "img", format: "skip" }],
    });
    let reply: Record<string, unknown> = {};
    if (params.replyToMessageId) {
      const message = await this.nativeMessage(params.replyToMessageId);
      reply = {
        replyToId: message.id,
        identity: thunderbirdIdentitySchema.parse(message),
      };
    }
    const result = z
      .object({
        draftId: z.number().int().positive(),
        message: thunderbirdMessageSchema,
      })
      .parse(
        await this.client.request("createDraft", {
          to,
          subject: params.subject,
          textPlain,
          ...reply,
        }),
      );
    if (
      result.draftId !== result.message.id ||
      result.message.folderId !== draftFolder
    )
      throw new Error(
        "Thunderbird draft outcome could not be confirmed; inspect before retrying",
      );
    return { id: thunderbirdMessageId(this.nativeAccountId, result.message) };
  }
  async draftEmail(
    email: Parameters<EmailProvider["draftEmail"]>[0],
    args: Parameters<EmailProvider["draftEmail"]>[1],
    _userEmail: string,
  ) {
    if (args.cc || args.bcc || args.attachments?.length)
      throw new ThunderbirdUnsupportedError("draft CC, BCC, or attachments");
    const result = await this.createDraft({
      to:
        args.to ??
        extractEmailAddress(email.headers["reply-to"] || email.headers.from),
      subject:
        args.subject ??
        (/^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`),
      messageHtml: args.content,
      replyToMessageId: email.id,
    });
    return { draftId: result.id };
  }
}
