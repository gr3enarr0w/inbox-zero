import type { EmailProvider, EmailThread } from "@/utils/email/types";
import type { ParsedMessage } from "@/utils/types";
import { ThunderbirdSearchProvider } from "@/utils/thunderbird/provider/search";
import { ThunderbirdUnsupportedError } from "@/utils/thunderbird/errors";
export class ThunderbirdThreadsProvider extends ThunderbirdSearchProvider {
  async getThread(
    id: string,
    options?: Parameters<EmailProvider["getThread"]>[1],
  ): Promise<EmailThread> {
    if (options?.complete)
      throw new ThunderbirdUnsupportedError("complete conversation membership");
    options?.signal?.throwIfAborted();
    const anchor = await this.getMessage(id);
    const messages = [anchor];
    const seen = new Set([anchor.headers["message-id"]]);
    let reply = anchor.headers["in-reply-to"]?.match(/<[^<>\s]+>/g)?.at(-1);
    for (let depth = 0; reply && depth < 5; depth++) {
      options?.signal?.throwIfAborted();
      if (seen.has(reply)) break;
      seen.add(reply);
      const previous = await this.getMessageByRfc822MessageId(reply);
      if (!previous) break;
      if (options?.includeDrafts || !previous.labelIds?.includes("DRAFT"))
        messages.push(previous);
      reply = previous.headers["in-reply-to"]?.match(/<[^<>\s]+>/g)?.at(-1);
    }
    messages.sort(
      (left, right) => Number(left.internalDate) - Number(right.internalDate),
    );
    return { id, messages, snippet: anchor.snippet };
  }
  async getThreadMessages(id: string) {
    return (await this.getThread(id)).messages;
  }
  async getThreadMessagesInInbox(id: string) {
    return (await this.getThreadMessages(id)).filter((message) =>
      message.labelIds?.includes("INBOX"),
    );
  }
  async getLatestMessageInThread(id: string) {
    return this.getMessage(id);
  }
  async getLatestMessageFromThreadSnapshot(
    thread: Pick<EmailThread, "id" | "messages">,
  ) {
    return (
      [...thread.messages].sort(
        (left, right) => Number(right.internalDate) - Number(left.internalDate),
      )[0] ?? null
    );
  }
  isReplyInThread(message: ParsedMessage) {
    return !!message.headers["in-reply-to"];
  }
  isSentMessage(message: ParsedMessage) {
    return message.labelIds?.includes("SENT") ?? false;
  }
  async searchThreads(options: Parameters<EmailProvider["searchThreads"]>[0]) {
    const page = await this.searchMessages(options);
    return {
      threads: page.messages.map(singleMessageThread),
      nextPageToken: page.nextPageToken,
    };
  }
  async getThreads(folderId?: string) {
    return (await this.getMessagesWithPagination({ folderId })).messages.map(
      singleMessageThread,
    );
  }
  async getThreadsWithLabel(
    options: Parameters<EmailProvider["getThreadsWithLabel"]>[0],
  ) {
    return (
      await this.getMessagesWithPagination({
        folderId: options.labelId,
        maxResults: options.maxResults,
      })
    ).messages.map(singleMessageThread);
  }
  async getThreadsWithQuery(
    options: Parameters<EmailProvider["getThreadsWithQuery"]>[0],
  ) {
    const query = options.query;
    if (
      query?.anyOf?.length ||
      query?.anyLabelIds?.length ||
      query?.excludeSplits?.length ||
      query?.excludeLabelNames?.length ||
      query?.inboxSection ||
      query?.category ||
      query?.splitId
    )
      throw new ThunderbirdUnsupportedError("advanced split filters");
    const tokens = [
      query?.q ?? "",
      query?.after ? `after:${query.after.toISOString()}` : "",
      query?.before ? `before:${query.before.toISOString()}` : "",
      query?.type && !["all", "label"].includes(query.type)
        ? query.type === "starred"
          ? "is:starred"
          : `in:${query.type}`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    const labelIds = query?.folderId
      ? [query.folderId]
      : query?.labelId
        ? [query.labelId]
        : (query?.labelIds ?? undefined);
    const page = await this.searchMessages({
      query: tokens,
      labelIds,
      fromEmail: query?.fromEmail ?? undefined,
      readState: query?.isUnread ? "unread" : undefined,
      maxResults: options.maxResults,
      pageToken: options.pageToken,
    });
    return {
      threads: page.messages.map(singleMessageThread),
      nextPageToken: page.nextPageToken,
    };
  }
  async getThreadsFromSenderWithSubject(sender: string, limit: number) {
    return (
      await this.getMessagesFromSender({
        senderEmail: sender,
        maxResults: limit,
      })
    ).messages.map((message) => ({
      id: message.id,
      snippet: message.snippet,
      subject: message.subject,
    }));
  }
  getThreadsWithParticipant: EmailProvider["getThreadsWithParticipant"] =
    async () => {
      throw new ThunderbirdUnsupportedError("participant union search");
    };
  getSentThreadsExcluding: EmailProvider["getSentThreadsExcluding"] =
    async () => {
      throw new ThunderbirdUnsupportedError("sent participant exclusions");
    };
}
function singleMessageThread(message: ParsedMessage): EmailThread {
  return { id: message.id, messages: [message], snippet: message.snippet };
}
