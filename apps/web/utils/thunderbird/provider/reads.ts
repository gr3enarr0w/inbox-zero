import { z } from "zod";
import type { EmailProvider } from "@/utils/email/types";
import { ThunderbirdFoldersProvider } from "@/utils/thunderbird/provider/folders";
import {
  thunderbirdMessageSchema,
  thunderbirdQuerySchema,
} from "@/utils/thunderbird/types";
import {
  assertThunderbirdIdentity,
  normalizeThunderbirdMessage,
  parseThunderbirdMessageId,
} from "@/utils/thunderbird/message";
import { ThunderbirdUnsupportedError } from "@/utils/thunderbird/errors";
export class ThunderbirdReadsProvider extends ThunderbirdFoldersProvider {
  protected async readPage(body: Record<string, unknown>) {
    const result = z
      .object({
        messages: z.array(thunderbirdMessageSchema).max(25),
        nextPageToken: z.string().optional(),
      })
      .parse(await this.client.request("listMessages", body));
    if (result.messages.length > Number(body.maxResults))
      throw new Error("Thunderbird page exceeded its requested bound");
    const folders = await this.getFolders();
    const messages = result.messages.map((message) => {
      const folder = folders.find((folder) => folder.id === message.folderId);
      if (!folder || (body.folderId && body.folderId !== message.folderId))
        throw new Error("Thunderbird message folder scope mismatch");
      return normalizeThunderbirdMessage(
        message,
        this.nativeAccountId,
        folder.systemType,
      );
    });
    return { messages, nextPageToken: result.nextPageToken };
  }
  protected async nativeMessage(id: string) {
    const reference = parseThunderbirdMessageId(id, this.nativeAccountId);
    const result = z.object({ message: thunderbirdMessageSchema }).parse(
      await this.client.request("getMessage", {
        messageId: reference.nativeId,
        identity: reference.identity,
      }),
    );
    assertThunderbirdIdentity(result.message, reference.identity);
    return result.message;
  }
  async getMessage(id: string) {
    const message = await this.nativeMessage(id);
    const folder = (await this.getFolders()).find(
      (folder) => folder.id === message.folderId,
    );
    if (!folder) throw new Error("Thunderbird message folder scope mismatch");
    return normalizeThunderbirdMessage(
      message,
      this.nativeAccountId,
      folder.systemType,
    );
  }
  async getMessagesWithPagination(
    options: Parameters<EmailProvider["getMessagesWithPagination"]>[0],
  ) {
    if (options.query)
      throw new ThunderbirdUnsupportedError(
        "raw queries in message listings; use searchMessages",
      );
    const maxResults = boundedTake(options.maxResults);
    const folderId =
      options.folderId ??
      (options.inboxOnly ? await this.systemFolder("INBOX") : undefined);
    const query = thunderbirdQuerySchema.parse({
      ...(options.before ? { toDate: options.before.toISOString() } : {}),
      ...(options.after ? { fromDate: options.after.toISOString() } : {}),
      ...(options.unreadOnly ? { read: false } : {}),
    });
    return this.readPage({
      maxResults,
      ...(folderId ? { folderId } : {}),
      ...(options.pageToken ? { pageToken: options.pageToken } : {}),
      ...(!folderId || Object.keys(query).length ? { query } : {}),
    });
  }
  async getInboxMessages(maxResults?: number) {
    return (
      await this.getMessagesWithPagination({ maxResults, inboxOnly: true })
    ).messages;
  }
  async getSentMessages(maxResults?: number) {
    return (
      await this.getMessagesWithPagination({
        maxResults,
        folderId: await this.systemFolder("SENT"),
      })
    ).messages;
  }
  async getDrafts(options?: { maxResults?: number }) {
    return (
      await this.getMessagesWithPagination({
        maxResults: options?.maxResults,
        folderId: await this.systemFolder("DRAFT"),
      })
    ).messages;
  }
  async getDraft(id: string, options?: { includeAttachments?: boolean }) {
    if (options?.includeAttachments)
      throw new ThunderbirdUnsupportedError("draft attachment transfer");
    const message = await this.getMessage(id);
    if (!message.labelIds?.includes("DRAFT"))
      throw new Error("Thunderbird draft scope mismatch");
    return message;
  }
  async getDraftReferenceForMessage(id: string) {
    const message = await this.getMessage(id);
    return message.labelIds?.includes("DRAFT") ? { id: message.id } : null;
  }
  async getMessagesBatch(ids: string[]) {
    if (ids.length > 25)
      throw new ThunderbirdUnsupportedError("message batches above 25");
    const messages = [];
    for (const id of ids) messages.push(await this.getMessage(id));
    return messages;
  }
  async getOriginalMessage(id: string | undefined) {
    return id ? this.getMessage(id) : null;
  }
  async getPreviousConversationMessages(ids: string[]) {
    return this.getMessagesBatch(ids);
  }
  async getMessageByRfc822MessageId(id: string) {
    const headerMessageId = id.replace(/^<|>$/g, "");
    const page = await this.readPage({
      maxResults: 25,
      query: { headerMessageId },
    });
    if (page.nextPageToken)
      throw new ThunderbirdUnsupportedError("ambiguous RFC message lookup");
    const matches = page.messages.filter(
      (message) =>
        message.headers["message-id"]?.replace(/^<|>$/g, "") ===
        headerMessageId,
    );
    if (matches.length > 1)
      throw new ThunderbirdUnsupportedError("ambiguous RFC message lookup");
    return matches[0] ? this.getMessage(matches[0].id) : null;
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
}
export function boundedTake(take = 25) {
  if (!Number.isSafeInteger(take) || take < 1)
    throw new Error("Invalid Thunderbird page size");
  return Math.min(take, 25);
}
