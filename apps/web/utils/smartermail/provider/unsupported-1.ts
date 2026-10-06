import type { EmailProvider } from "@/utils/email/types";
import { SmarterMailUnsupportedError } from "@/utils/smartermail/provider/error";
import { SmarterMailUnsupported0 } from "@/utils/smartermail/provider/unsupported-0";
export abstract class SmarterMailUnsupported1 extends SmarterMailUnsupported0 {
  async getContactPhotos(
    ..._args: Parameters<EmailProvider["getContactPhotos"]>
  ): Promise<Awaited<ReturnType<EmailProvider["getContactPhotos"]>>> {
    throw new SmarterMailUnsupportedError("getContactPhotos");
  }
  async getFiltersList(
    ..._args: Parameters<EmailProvider["getFiltersList"]>
  ): Promise<Awaited<ReturnType<EmailProvider["getFiltersList"]>>> {
    throw new SmarterMailUnsupportedError("getFiltersList");
  }
  async getForwardingAddresses(
    ..._args: Parameters<EmailProvider["getForwardingAddresses"]>
  ): Promise<Awaited<ReturnType<EmailProvider["getForwardingAddresses"]>>> {
    throw new SmarterMailUnsupportedError("getForwardingAddresses");
  }
  async getMailboxSyncPage(
    ..._args: Parameters<EmailProvider["getMailboxSyncPage"]>
  ): Promise<Awaited<ReturnType<EmailProvider["getMailboxSyncPage"]>>> {
    throw new SmarterMailUnsupportedError("getMailboxSyncPage");
  }
  async getMessageByRfc822MessageId(
    ..._args: Parameters<EmailProvider["getMessageByRfc822MessageId"]>
  ): Promise<
    Awaited<ReturnType<EmailProvider["getMessageByRfc822MessageId"]>>
  > {
    throw new SmarterMailUnsupportedError("getMessageByRfc822MessageId");
  }
  async getMessagesFromSender(
    ..._args: Parameters<EmailProvider["getMessagesFromSender"]>
  ): Promise<Awaited<ReturnType<EmailProvider["getMessagesFromSender"]>>> {
    throw new SmarterMailUnsupportedError("getMessagesFromSender");
  }
  async getMessagesWithAttachments(
    ..._args: Parameters<EmailProvider["getMessagesWithAttachments"]>
  ): Promise<Awaited<ReturnType<EmailProvider["getMessagesWithAttachments"]>>> {
    throw new SmarterMailUnsupportedError("getMessagesWithAttachments");
  }
  async getSentMessageIds(
    ..._args: Parameters<EmailProvider["getSentMessageIds"]>
  ): Promise<Awaited<ReturnType<EmailProvider["getSentMessageIds"]>>> {
    throw new SmarterMailUnsupportedError("getSentMessageIds");
  }
  async getSentThreadsExcluding(
    ..._args: Parameters<EmailProvider["getSentThreadsExcluding"]>
  ): Promise<Awaited<ReturnType<EmailProvider["getSentThreadsExcluding"]>>> {
    throw new SmarterMailUnsupportedError("getSentThreadsExcluding");
  }
  async getSignatures(
    ..._args: Parameters<EmailProvider["getSignatures"]>
  ): Promise<Awaited<ReturnType<EmailProvider["getSignatures"]>>> {
    throw new SmarterMailUnsupportedError("getSignatures");
  }
  async getThreadsFromSenderWithSubject(
    ..._args: Parameters<EmailProvider["getThreadsFromSenderWithSubject"]>
  ): Promise<
    Awaited<ReturnType<EmailProvider["getThreadsFromSenderWithSubject"]>>
  > {
    throw new SmarterMailUnsupportedError("getThreadsFromSenderWithSubject");
  }
  async getThreadsWithParticipant(
    ..._args: Parameters<EmailProvider["getThreadsWithParticipant"]>
  ): Promise<Awaited<ReturnType<EmailProvider["getThreadsWithParticipant"]>>> {
    throw new SmarterMailUnsupportedError("getThreadsWithParticipant");
  }
}
