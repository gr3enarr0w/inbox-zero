import { extractEmailAddress } from "@/utils/email";
import type { EmailProvider } from "@/utils/email/types";
import type { ParsedMessage } from "@/utils/types";
import {
  normalizeSmarterMailMessage,
  smarterMailFolderRole,
} from "@/utils/smartermail/message";

import { SmarterMailThreadsProvider } from "@/utils/smartermail/provider/threads";
import { SmarterMailUnsupportedError } from "@/utils/smartermail/provider/error";
import { compileSmarterMailSearch } from "@/utils/smartermail/search-query";
import { fetchSmarterMailFolderPage } from "@/utils/smartermail/provider/folder-page";
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
      signal?: AbortSignal;
    },
  ) {
    options.signal?.throwIfAborted();
    if (
      options.mailboxSearch?.text ||
      options.mailboxSearch?.excludedRoles?.length
    )
      throw new SmarterMailUnsupportedError("advanced mailbox predicates");
    const compiled = compileSmarterMailSearch(
      options.headerReference ? "" : options.query,
    );
    const mailbox = options.mailboxSearch?.mailbox;
    const compiledFolder = compiled.role
      ? await this.systemFolder(compiled.role)
      : undefined;
    const folder =
      options.folderId ??
      (options.folder
        ? await this.systemFolder(options.folder === "spam" ? "SPAM" : "TRASH")
        : mailbox && mailbox !== "all" && mailbox !== "starred"
          ? await this.systemFolder(roleFromMailbox(mailbox))
          : undefined);
    if (folder && compiledFolder && folder !== compiledFolder)
      throw new Error("Conflicting SmarterMail search folders");
    const searchFolder = folder ?? compiledFolder;
    const skip = searchFolder ? parsePageToken(options.pageToken) : 0;
    const requestedTake = options.maxResults ?? 50;
    if (
      !Number.isInteger(requestedTake) ||
      requestedTake < 1 ||
      requestedTake > 100
    )
      throw new Error("SmarterMail page size must be between 1 and 100");
    const take = searchFolder ? requestedTake : Math.min(25, requestedTake);
    const structuredCategories =
      options.labelIds?.map(categoryName) ??
      (options.labelName ? [options.labelName] : undefined);
    if (
      compiled.category &&
      structuredCategories &&
      (structuredCategories.length !== 1 ||
        structuredCategories[0] !== compiled.category)
    )
      throw new Error("Conflicting SmarterMail search categories");
    const categories =
      structuredCategories ??
      (compiled.category ? [compiled.category] : undefined);
    const read = options.readState
      ? options.readState === "read"
      : (options.mailboxSearch?.read ?? compiled.read);
    const starred =
      mailbox === "starred"
        ? true
        : (options.mailboxSearch?.starred ?? compiled.starred);
    if (
      (compiled.read !== undefined && read !== compiled.read) ||
      (compiled.starred !== undefined && starred !== compiled.starred) ||
      (compiled.hasAttachment !== undefined &&
        options.mailboxSearch?.hasAttachment !== undefined &&
        compiled.hasAttachment !== options.mailboxSearch.hasAttachment) ||
      (compiled.fromEmail &&
        options.fromEmail &&
        compiled.fromEmail !== options.fromEmail) ||
      (compiled.after && options.after && +compiled.after !== +options.after) ||
      (compiled.before &&
        options.before &&
        +compiled.before !== +options.before)
    )
      throw new Error("Conflicting SmarterMail search filters");
    const fromEmail = options.fromEmail ?? compiled.fromEmail;
    if (fromEmail && compiled.query)
      throw new SmarterMailUnsupportedError("combining sender and text search");
    const after = options.after ?? compiled.after;
    const before = options.before ?? compiled.before;
    const hasAttachment =
      options.mailboxSearch?.hasAttachment ?? compiled.hasAttachment;
    const searchFlags: Record<string, boolean> = {};
    if (read !== undefined) searchFlags["0"] = read;
    if (starred !== undefined) searchFlags["4"] = starred;
    if (hasAttachment !== undefined) searchFlags["7"] = hasAttachment;
    const body = {
      query: options.headerReference ?? fromEmail ?? compiled.query,
      ...(options.headerReference
        ? { fieldsToSearch: 64 }
        : fromEmail
          ? { fieldsToSearch: 1 }
          : {}),
      searchFlags,
      ...(after ? { messagesSince: after.toISOString() } : {}),
      ...(before ? { messagesBefore: before.toISOString() } : {}),
      ...(categories
        ? {
            categoryFilter: {
              filteredCategories: categories,
              includeNoCategory: false,
            },
          }
        : {}),
    };
    const result = searchFolder
      ? {
          ...listingSchema.parse(
            await this.client.request("search", {
              ...body,
              folder: searchFolder,
              skip,
              take,
              includeSubFolders: false,
            }),
          ),
          nextPageToken: undefined as string | undefined,
        }
      : await fetchSmarterMailFolderPage({
          client: this.client,
          scope: this.emailAccountId,
          folders: (await this.getFolders())
            .filter(
              (folder) =>
                options.includeSpamTrash ||
                !["SPAM", "TRASH"].includes(folder.systemType ?? ""),
            )
            .map((folder) => folder.id),
          body,
          take,
          pageToken: options.pageToken,
          signal: options.signal,
        });
    options.signal?.throwIfAborted();
    if (result.results.length > take)
      throw new Error("SmarterMail returned more than the requested page size");
    const messages: ParsedMessage[] = [];
    for (const row of result.results) {
      options.signal?.throwIfAborted();
      const rowFolder =
        searchFolder ??
        (typeof row.folder === "string" ? row.folder : undefined);
      if (
        searchFolder &&
        row.folder !== undefined &&
        row.folder !== searchFolder
      )
        throw new Error("SmarterMail search folder scope mismatch");
      if (!rowFolder)
        throw new Error("SmarterMail search result has no folder reference");
      if (
        !options.includeSpamTrash &&
        !options.folder &&
        !searchFolder &&
        ["SPAM", "TRASH"].includes(smarterMailFolderRole(rowFolder) ?? "")
      )
        continue;
      const detail = await this.client.request("message", {
        folder: rowFolder,
        uid: row.uid,
      });
      options.signal?.throwIfAborted();
      const message = normalizeSmarterMailMessage(
        detail,
        rowFolder,
        row.uid,
        row,
      );
      if (
        fromEmail &&
        extractEmailAddress(message.headers.from).toLowerCase() !==
          fromEmail.toLowerCase()
      )
        continue;
      messages.push(message);
    }
    return {
      messages,
      nextPageToken: searchFolder
        ? result.results.length === take
          ? String(skip + take)
          : undefined
        : result.nextPageToken,
    };
  }
}
