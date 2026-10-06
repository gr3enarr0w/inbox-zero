import type { EmailProvider } from "@/utils/email/types";
import { smarterMailCategoryId } from "@/utils/smartermail/message";
import { SmarterMailSearchProvider } from "@/utils/smartermail/provider/search";
import { SmarterMailUnsupportedError } from "@/utils/smartermail/provider/error";
import {
  toThread,
  roleFromMailbox,
} from "@/utils/smartermail/provider/helpers";
export class SmarterMailQueriesProvider extends SmarterMailSearchProvider {
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
      query?.splitId
    )
      throw new SmarterMailUnsupportedError("split inbox queries");
    const folderId =
      query?.folderId ??
      (query?.type
        ? await this.systemFolder(roleFromMailbox(query.type))
        : await this.systemFolder("INBOX"));
    if (
      query?.fromEmail ||
      query?.labelIds?.length ||
      query?.labelId ||
      query?.category
    ) {
      const result = await this.searchMessages({
        query: query.q ?? "",
        folderId,
        after: query.after ?? undefined,
        before: query.before ?? undefined,
        readState: query.isUnread ? "unread" : undefined,
        fromEmail: query.fromEmail ?? undefined,
        labelIds:
          query.labelIds ??
          (query.labelId
            ? [query.labelId]
            : query.category
              ? [smarterMailCategoryId(query.category)]
              : undefined),
        maxResults: options.maxResults,
        pageToken: options.pageToken,
      });
      return {
        threads: result.messages.map(toThread),
        nextPageToken: result.nextPageToken,
      };
    }
    const result = await this.getMessagesWithPagination({
      folderId,
      query: query?.q ?? undefined,
      maxResults: options.maxResults,
      pageToken: options.pageToken,
      after: query?.after ?? undefined,
      before: query?.before ?? undefined,
      unreadOnly: query?.isUnread ?? false,
    });
    return {
      threads: result.messages.map(toThread),
      nextPageToken: result.nextPageToken,
    };
  }
}
