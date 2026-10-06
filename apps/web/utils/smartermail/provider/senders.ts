import type { EmailProvider } from "@/utils/email/types";
import { SmarterMailQueriesProvider } from "@/utils/smartermail/provider/queries";
import { toThread } from "@/utils/smartermail/provider/helpers";

export class SmarterMailSendersProvider extends SmarterMailQueriesProvider {
  async getMessagesFromSender(
    options: Parameters<EmailProvider["getMessagesFromSender"]>[0],
  ) {
    return this.searchMessages({
      query: "",
      fromEmail: options.senderEmail,
      maxResults: options.maxResults,
      pageToken: options.pageToken,
      after: options.after,
      before: options.before,
    });
  }
  async countReceivedMessages(senderEmail: string, threshold: number) {
    if (!Number.isInteger(threshold) || threshold < 1)
      throw new Error("Invalid received-message threshold");
    let count = 0;
    let pageToken: string | undefined;
    do {
      const page = await this.searchMessages({
        query: "",
        fromEmail: senderEmail,
        maxResults: Math.min(100, threshold - count),
        pageToken,
      });
      count += page.messages.filter(
        (message) => !this.isSentMessage(message),
      ).length;
      pageToken = page.nextPageToken;
    } while (pageToken && count < threshold);
    return count;
  }
  async getSentMessageIds(
    options: Parameters<EmailProvider["getSentMessageIds"]>[0],
  ) {
    const page = await this.getMessagesWithPagination({
      ...options,
      folderId: await this.systemFolder("SENT"),
    });
    return {
      messages: page.messages.map((message) => ({
        id: message.id,
        threadId: message.threadId,
      })),
      nextPageToken: page.nextPageToken,
    };
  }
  async getThreadsFromSenderWithSubject(sender: string, limit: number) {
    const page = await this.getMessagesFromSender({
      senderEmail: sender,
      maxResults: limit,
    });
    return page.messages.map((message) => ({
      id: message.threadId,
      snippet: message.snippet,
      subject: message.subject,
    }));
  }
  async getSentThreadsExcluding(
    options: Parameters<EmailProvider["getSentThreadsExcluding"]>[0],
  ) {
    const messages = await this.getSentMessages(options.maxResults);
    if (options.excludeFromEmails?.length || options.excludeToEmails?.length) {
      throw new Error(
        "SmarterMail sent participant exclusion is not supported",
      );
    }
    return messages.map(toThread);
  }
}
