import type { EmailProvider } from "@/utils/email/types";
import { SmarterMailUnsupportedError } from "@/utils/smartermail/provider/error";
import { SmarterMailUnsupported1 } from "@/utils/smartermail/provider/unsupported-1";
export abstract class SmarterMailUnsupported2 extends SmarterMailUnsupported1 {
  async hasPreviousCommunicationsWithSenderOrDomain(
    ..._args: Parameters<
      EmailProvider["hasPreviousCommunicationsWithSenderOrDomain"]
    >
  ): Promise<
    Awaited<
      ReturnType<EmailProvider["hasPreviousCommunicationsWithSenderOrDomain"]>
    >
  > {
    throw new SmarterMailUnsupportedError(
      "hasPreviousCommunicationsWithSenderOrDomain",
    );
  }
  async replyToEmail(
    ..._args: Parameters<EmailProvider["replyToEmail"]>
  ): Promise<Awaited<ReturnType<EmailProvider["replyToEmail"]>>> {
    throw new SmarterMailUnsupportedError("replyToEmail");
  }
  async searchContacts(
    ..._args: Parameters<EmailProvider["searchContacts"]>
  ): Promise<Awaited<ReturnType<EmailProvider["searchContacts"]>>> {
    throw new SmarterMailUnsupportedError("searchContacts");
  }
  async sendDraft(
    ..._args: Parameters<EmailProvider["sendDraft"]>
  ): Promise<Awaited<ReturnType<EmailProvider["sendDraft"]>>> {
    throw new SmarterMailUnsupportedError("sendDraft");
  }
  async sendEmail(
    ..._args: Parameters<EmailProvider["sendEmail"]>
  ): Promise<Awaited<ReturnType<EmailProvider["sendEmail"]>>> {
    throw new SmarterMailUnsupportedError("sendEmail");
  }
  async sendEmailWithHtml(
    ..._args: Parameters<EmailProvider["sendEmailWithHtml"]>
  ): Promise<Awaited<ReturnType<EmailProvider["sendEmailWithHtml"]>>> {
    throw new SmarterMailUnsupportedError("sendEmailWithHtml");
  }
  async syncLocalMail(
    ..._args: Parameters<EmailProvider["syncLocalMail"]>
  ): Promise<Awaited<ReturnType<EmailProvider["syncLocalMail"]>>> {
    throw new SmarterMailUnsupportedError("syncLocalMail");
  }
  async unwatchEmails(
    ..._args: Parameters<EmailProvider["unwatchEmails"]>
  ): Promise<Awaited<ReturnType<EmailProvider["unwatchEmails"]>>> {
    throw new SmarterMailUnsupportedError("unwatchEmails");
  }
  async updateLabel(
    ..._args: Parameters<EmailProvider["updateLabel"]>
  ): Promise<Awaited<ReturnType<EmailProvider["updateLabel"]>>> {
    throw new SmarterMailUnsupportedError("updateLabel");
  }
  async watchEmails(
    ..._args: Parameters<EmailProvider["watchEmails"]>
  ): Promise<Awaited<ReturnType<EmailProvider["watchEmails"]>>> {
    throw new SmarterMailUnsupportedError("watchEmails");
  }
}
