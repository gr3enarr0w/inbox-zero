import type { EmailProvider } from "@/utils/email/types";
import type { ParsedMessage } from "@/utils/types";
import {
  normalizeSmarterMailMessage,
  smarterMailFolderRole,
} from "@/utils/smartermail/message";

import { SmarterMailThreadsProvider } from "@/utils/smartermail/provider/threads";
import { SmarterMailUnsupportedError } from "@/utils/smartermail/provider/error";
import { listingSchema } from "@/utils/smartermail/provider/schemas";
import {
  toThread,
  parsePageToken,
  categoryName,
  roleFromMailbox,
} from "@/utils/smartermail/provider/helpers";

export class SmarterMailSearchProvider extends SmarterMailThreadsProvider {
  async getThreadsWithLabel(
    options: Parameters<EmailProvider["getThreadsWithLabel"]>[0],
  ) {
    return (
      await this.searchMessages({
        query: "",
        labelIds: [options.labelId],
        maxResults: options.maxResults,
      })
    ).messages.map(toThread);
  }
  async searchThreads(options: Parameters<EmailProvider["searchThreads"]>[0]) {
    const result = await this.searchMessages(options);
    return {
      threads: result.messages.map(toThread),
      nextPageToken: result.nextPageToken,
    };
  }
  async searchMessages(
    options: Parameters<EmailProvider["searchMessages"]>[0] & {
      folderId?: string;
      after?: Date;
      before?: Date;
      headerReference?: string;
    },
  ) {
    if (
      options.mailboxSearch?.text ||
      options.mailboxSearch?.excludedRoles?.length
    )
      throw new SmarterMailUnsupportedError("advanced mailbox predicates");
    const mailbox = options.mailboxSearch?.mailbox;
    const folder =
      options.folderId ??
      (options.folder
        ? await this.systemFolder(options.folder === "spam" ? "SPAM" : "TRASH")
        : mailbox && mailbox !== "all" && mailbox !== "starred"
          ? await this.systemFolder(roleFromMailbox(mailbox))
          : undefined);
    const skip = parsePageToken(options.pageToken);
    const take = options.maxResults ?? 50;
    if (!Number.isInteger(take) || take < 1 || take > 100)
      throw new Error("SmarterMail page size must be between 1 and 100");
    const categories =
      options.labelIds?.map(categoryName) ??
      (options.labelName ? [options.labelName] : undefined);
    const read = options.readState
      ? options.readState === "read"
      : options.mailboxSearch?.read;
    const starred =
      mailbox === "starred" ? true : options.mailboxSearch?.starred;
    const searchFlags: Record<string, boolean> = {};
    if (read !== undefined) searchFlags["0"] = read;
    if (starred !== undefined) searchFlags["4"] = starred;
    if (options.mailboxSearch?.hasAttachment !== undefined)
      searchFlags["7"] = options.mailboxSearch.hasAttachment;
    const result = listingSchema.parse(
      await this.client.request("search", {
        query: options.headerReference ?? options.query,
        ...(options.headerReference ? { fieldsToSearch: 64 } : {}),
        folder: folder ?? "",
        skip,
        take,
        includeSubFolders: !folder,
        searchFlags,
        ...(options.fromEmail
          ? { searchFieldValueMap: { 1: options.fromEmail } }
          : {}),
        ...(options.after
          ? { messagesSince: options.after.toISOString() }
          : {}),
        ...(options.before
          ? { messagesBefore: options.before.toISOString() }
          : {}),
        ...(categories
          ? {
              categoryFilter: {
                filteredCategories: categories,
                includeNoCategory: false,
              },
            }
          : {}),
      }),
    );
    const messages: ParsedMessage[] = [];
    for (const row of result.results) {
      const rowFolder =
        folder ?? (typeof row.folder === "string" ? row.folder : undefined);
      if (!rowFolder)
        throw new Error("SmarterMail search result has no folder reference");
      if (
        !options.includeSpamTrash &&
        !options.folder &&
        !folder &&
        ["SPAM", "TRASH"].includes(smarterMailFolderRole(rowFolder) ?? "")
      )
        continue;
      messages.push(
        normalizeSmarterMailMessage(
          await this.client.request("message", {
            folder: rowFolder,
            uid: row.uid,
          }),
          rowFolder,
          row.uid,
          row,
        ),
      );
    }
    return {
      messages,
      nextPageToken:
        result.results.length === take ? String(skip + take) : undefined,
    };
  }
}
