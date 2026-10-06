import { z } from "zod";
import { smarterMailMessageId } from "@/utils/smartermail/message";
import { SmarterMailMessageNotFoundError } from "@/utils/smartermail/errors";
import type { EmailProvider } from "@/utils/email/types";
import type { ParsedMessage } from "@/utils/types";
import {
  normalizeSmarterMailMessage,
  parseSmarterMailMessageId,
  smarterMailFolderRole,
} from "@/utils/smartermail/message";

import { SmarterMailCategoriesProvider } from "@/utils/smartermail/provider/categories";
import { SmarterMailUnsupportedError } from "@/utils/smartermail/provider/error";
import { listingSchema } from "@/utils/smartermail/provider/schemas";
import { parsePageToken } from "@/utils/smartermail/provider/helpers";

export class SmarterMailReadsProvider extends SmarterMailCategoriesProvider {
  async hasMessagesInFolder(
    folderId: string,
    ids: string[],
  ): Promise<string[]> {
    if (ids.length > 25)
      throw new Error("SmarterMail presence checks support at most 25 IDs");
    const references = ids.map(parseSmarterMailMessageId);
    if (references.some((reference) => reference.folder !== folderId))
      throw new Error("SmarterMail presence scope mismatch");
    const present: string[] = [];
    for (const uid of new Set(references.map((reference) => reference.uid))) {
      try {
        const response = z
          .object({
            success: z.literal(true),
            messageData: z.object({
              uid: z.number().int().positive(),
              folder: z.string().min(1),
            }),
          })
          .parse(
            await this.client.request("message", { folder: folderId, uid }),
          );
        if (
          response.messageData.uid !== uid ||
          response.messageData.folder !== folderId
        )
          throw new Error("SmarterMail presence identity mismatch");
        present.push(smarterMailMessageId(folderId, uid));
      } catch (error) {
        if (!(error instanceof SmarterMailMessageNotFoundError)) throw error;
      }
    }
    return present;
  }
  async getMessage(messageId: string) {
    const { folder, uid } = parseSmarterMailMessageId(messageId);
    return normalizeSmarterMailMessage(
      await this.client.request("message", { folder, uid }),
      folder,
      uid,
    );
  }
  async getMessagesBatch(messageIds: string[]) {
    return Promise.all(messageIds.map((id) => this.getMessage(id)));
  }
  async getMessagesWithPagination(
    options: Parameters<EmailProvider["getMessagesWithPagination"]>[0] = {},
  ) {
    const folder =
      options.folderId ??
      (options.inboxOnly ? await this.systemFolder("INBOX") : undefined);
    if (!folder)
      throw new SmarterMailUnsupportedError(
        "unscoped message listing; select a folder",
      );
    const take = options.maxResults ?? 50;
    if (!Number.isInteger(take) || take < 1 || take > 100)
      throw new Error("SmarterMail page size must be between 1 and 100");
    const skip = parsePageToken(options.pageToken);
    const payload = listingSchema.parse(
      await this.client.request("messages", {
        folder,
        query: options.query ?? "",
        skip,
        take,
        sortAscending: false,
        ...(options.after
          ? { messagesSince: options.after.toISOString() }
          : {}),
        ...(options.before
          ? { messagesBefore: options.before.toISOString() }
          : {}),
        ...(options.unreadOnly ? { searchFlags: { 0: false } } : {}),
      }),
    );
    const messages: ParsedMessage[] = [];
    // Bound concurrency and hydrate message bodies before AI classification.
    for (const summary of payload.results) {
      const detail = await this.client.request("message", {
        folder,
        uid: summary.uid,
      });
      messages.push(
        normalizeSmarterMailMessage(detail, folder, summary.uid, summary),
      );
    }
    return {
      messages,
      nextPageToken:
        payload.results.length === take ? String(skip + take) : undefined,
    };
  }
  async getInboxMessages(maxResults = 50) {
    return (
      await this.getMessagesWithPagination({ inboxOnly: true, maxResults })
    ).messages;
  }
  async getSentMessages(maxResults = 50) {
    return (
      await this.getMessagesWithPagination({
        folderId: await this.systemFolder("SENT"),
        maxResults,
      })
    ).messages;
  }
  async getDrafts(options?: { maxResults?: number }) {
    return (
      await this.getMessagesWithPagination({
        folderId: await this.systemFolder("DRAFT"),
        maxResults: options?.maxResults,
      })
    ).messages;
  }
  async getDraft(draftId: string) {
    const reference = parseSmarterMailMessageId(draftId);
    if (smarterMailFolderRole(reference.folder) !== "DRAFT")
      throw new Error("Message is not a SmarterMail draft");
    return this.getMessage(draftId);
  }
  async getDraftReferenceForMessage(messageId: string) {
    return smarterMailFolderRole(
      parseSmarterMailMessageId(messageId).folder,
    ) === "DRAFT"
      ? { id: messageId }
      : null;
  }
}
