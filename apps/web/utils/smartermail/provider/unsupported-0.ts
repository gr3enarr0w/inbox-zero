import type { EmailProvider } from "@/utils/email/types";
import { SmarterMailUnsupportedError } from "@/utils/smartermail/provider/error";
import { SmarterMailProviderContext } from "@/utils/smartermail/provider/context";
export abstract class SmarterMailUnsupported0 extends SmarterMailProviderContext {
  async blockUnsubscribedEmail(
    ..._args: Parameters<EmailProvider["blockUnsubscribedEmail"]>
  ): Promise<Awaited<ReturnType<EmailProvider["blockUnsubscribedEmail"]>>> {
    throw new SmarterMailUnsupportedError("blockUnsubscribedEmail");
  }
  async bulkArchiveFromSenders(
    ..._args: Parameters<EmailProvider["bulkArchiveFromSenders"]>
  ): Promise<Awaited<ReturnType<EmailProvider["bulkArchiveFromSenders"]>>> {
    throw new SmarterMailUnsupportedError("bulkArchiveFromSenders");
  }
  async bulkTrashFromSenders(
    ..._args: Parameters<EmailProvider["bulkTrashFromSenders"]>
  ): Promise<Awaited<ReturnType<EmailProvider["bulkTrashFromSenders"]>>> {
    throw new SmarterMailUnsupportedError("bulkTrashFromSenders");
  }
  async checkIfReplySent(
    ..._args: Parameters<EmailProvider["checkIfReplySent"]>
  ): Promise<Awaited<ReturnType<EmailProvider["checkIfReplySent"]>>> {
    throw new SmarterMailUnsupportedError("checkIfReplySent");
  }
  async countReceivedMessages(
    ..._args: Parameters<EmailProvider["countReceivedMessages"]>
  ): Promise<Awaited<ReturnType<EmailProvider["countReceivedMessages"]>>> {
    throw new SmarterMailUnsupportedError("countReceivedMessages");
  }
  async createAutoArchiveFilter(
    ..._args: Parameters<EmailProvider["createAutoArchiveFilter"]>
  ): Promise<Awaited<ReturnType<EmailProvider["createAutoArchiveFilter"]>>> {
    throw new SmarterMailUnsupportedError("createAutoArchiveFilter");
  }
  async createFilter(
    ..._args: Parameters<EmailProvider["createFilter"]>
  ): Promise<Awaited<ReturnType<EmailProvider["createFilter"]>>> {
    throw new SmarterMailUnsupportedError("createFilter");
  }
  async deleteFilter(
    ..._args: Parameters<EmailProvider["deleteFilter"]>
  ): Promise<Awaited<ReturnType<EmailProvider["deleteFilter"]>>> {
    throw new SmarterMailUnsupportedError("deleteFilter");
  }
  async deleteLabel(
    ..._args: Parameters<EmailProvider["deleteLabel"]>
  ): Promise<Awaited<ReturnType<EmailProvider["deleteLabel"]>>> {
    throw new SmarterMailUnsupportedError("deleteLabel");
  }
  async forwardEmail(
    ..._args: Parameters<EmailProvider["forwardEmail"]>
  ): Promise<Awaited<ReturnType<EmailProvider["forwardEmail"]>>> {
    throw new SmarterMailUnsupportedError("forwardEmail");
  }
  async getAttachment(
    ..._args: Parameters<EmailProvider["getAttachment"]>
  ): Promise<Awaited<ReturnType<EmailProvider["getAttachment"]>>> {
    throw new SmarterMailUnsupportedError("getAttachment");
  }
  async getAttachmentStream(
    ..._args: Parameters<EmailProvider["getAttachmentStream"]>
  ): Promise<Awaited<ReturnType<EmailProvider["getAttachmentStream"]>>> {
    throw new SmarterMailUnsupportedError("getAttachmentStream");
  }
}
