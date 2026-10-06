import type { EmailProvider, EmailThread } from "@/utils/email/types";
import type { ParsedMessage } from "@/utils/types";
import { SmarterMailSendersProvider } from "@/utils/smartermail/provider/senders";

export class SmarterMailConversationsProvider extends SmarterMailSendersProvider {
  async getMessageByRfc822MessageId(reference: string) {
    validateReference(reference);
    const result = await this.searchMessages({
      query: "",
      headerReference: reference,
      maxResults: 100,
      includeSpamTrash: true,
    });
    const match = result.messages.find(
      (message) => message.headers["message-id"] === reference,
    );
    if (!match && result.nextPageToken)
      throw new Error(
        "SmarterMail header lookup exceeded its safe result limit",
      );
    return match ?? null;
  }
  async getThread(
    threadId: string,
    options?: Parameters<EmailProvider["getThread"]>[1],
  ): Promise<EmailThread> {
    options?.signal?.throwIfAborted();
    const anchor = await this.getMessage(threadId);
    const messages = new Map<string, ParsedMessage>([[anchor.id, anchor]]);
    const references = headerReferences(anchor);
    const ancestorIds = references.filter(
      (reference) => reference !== anchor.headers["message-id"],
    );
    if (options?.complete && ancestorIds.length > 20)
      throw new Error(
        "SmarterMail conversation exceeds its safe ancestor limit",
      );
    for (const reference of ancestorIds.slice(-20)) {
      options?.signal?.throwIfAborted();
      const ancestor = await this.getMessageByRfc822MessageId(reference);
      if (ancestor) messages.set(ancestor.id, ancestor);
    }
    const rootReference = references[0];
    if (rootReference) {
      const result = await this.searchMessages({
        query: "",
        headerReference: rootReference,
        maxResults: 100,
        includeSpamTrash: true,
      });
      if (options?.complete && result.nextPageToken)
        throw new Error(
          "SmarterMail conversation exceeds its safe result limit",
        );
      for (const candidate of result.messages) {
        if (headerReferences(candidate).includes(rootReference))
          messages.set(candidate.id, candidate);
      }
    }
    const ordered = [...messages.values()]
      .filter(
        (message) =>
          options?.includeDrafts || !message.labelIds?.includes("DRAFT"),
      )
      .sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
    return {
      id: threadId,
      messages: ordered,
      snippet: ordered.at(-1)?.snippet ?? anchor.snippet,
    };
  }
  async getThreadMessages(threadId: string) {
    return (await this.getThread(threadId)).messages;
  }
  async getLatestMessageInThread(threadId: string) {
    return (await this.getThread(threadId)).messages.at(-1) ?? null;
  }
  async getThreadMessagesInInbox(threadId: string) {
    return (await this.getThread(threadId)).messages.filter((message) =>
      message.labelIds?.includes("INBOX"),
    );
  }
}

function validateReference(reference: string) {
  if (!/^<[^<>\s]{1,998}>$/.test(reference))
    throw new Error("Invalid RFC Message-ID reference");
}
function headerReferences(message: ParsedMessage) {
  const references: string[] =
    (message.headers.references ?? "").match(/<[^<>\s]+>/g) ?? [];
  const reply = message.headers["in-reply-to"];
  if (reply && !references.includes(reply)) references.push(reply);
  const own = message.headers["message-id"];
  if (own && !references.includes(own)) references.push(own);
  return references.filter((reference) => /^<[^<>\s]{1,998}>$/.test(reference));
}
