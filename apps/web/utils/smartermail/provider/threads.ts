import type { EmailThread } from "@/utils/email/types";
import type { ParsedMessage } from "@/utils/types";
import { toThread } from "@/utils/smartermail/provider/helpers";
import { SmarterMailReadsProvider } from "@/utils/smartermail/provider/reads";
export class SmarterMailThreadsProvider extends SmarterMailReadsProvider {
  async getThread(threadId: string) {
    return toThread(await this.getMessage(threadId));
  }
  async getThreadMessages(threadId: string) {
    return [await this.getMessage(threadId)];
  }
  async getLatestMessageInThread(
    threadId: string,
  ): Promise<ParsedMessage | null> {
    return this.getMessage(threadId);
  }
  async getLatestMessageFromThreadSnapshot(
    thread: Pick<EmailThread, "id" | "messages">,
  ) {
    return thread.messages.at(-1) ?? null;
  }
  async getThreadMessagesInInbox(threadId: string) {
    const message = await this.getMessage(threadId);
    return message.labelIds?.includes("INBOX") ? [message] : [];
  }
  async getThreads(folderId?: string) {
    return (
      await this.getMessagesWithPagination({ folderId, inboxOnly: !folderId })
    ).messages.map(toThread);
  }
  isSentMessage(message: ParsedMessage) {
    return message.labelIds?.includes("SENT") ?? false;
  }
  isReplyInThread(message: ParsedMessage) {
    return !!message.headers["in-reply-to"];
  }
  async getOriginalMessage(id: string | undefined) {
    return id ? this.getMessage(id) : null;
  }
  async getPreviousConversationMessages(ids: string[]) {
    return this.getMessagesBatch(ids);
  }
}
