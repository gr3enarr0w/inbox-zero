import { z } from "zod";
import { smarterMailMessageId } from "@/utils/smartermail/message";
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
    if (ids.length > 100)
      throw new Error("SmarterMail presence checks support at most 100 IDs");
    const references = ids.map(parseSmarterMailMessageId);
    if (references.some((reference) => reference.folder !== folderId))
      throw new Error("SmarterMail presence scope mismatch");
    if (!references.length) return [];
    const selectedIds = [
      ...new Set(references.map((reference) => reference.uid)),
    ];
    const response = z
      .object({
        success: z.literal(true),
        totalCount: z.number().int().nonnegative(),
        results: z.array(z.number().int().positive()),
      })
      .parse(
        await this.client.request("messagesUid", {
          folder: folderId,
          selectedIds,
          skip: 0,
          take: 100,
          query: "",
        }),
      );
    if (
      response.totalCount !== response.results.length ||
      response.results.some((uid) => !selectedIds.includes(uid))
    )
      throw new Error(
        "SmarterMail returned an incomplete or unscoped presence response",
      );
    return response.results.map((uid) => smarterMailMessageId(folderId, uid));
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
