import type { EmailProvider } from "@/utils/email/types";
import { extractEmailAddress } from "@/utils/email";
import {
  tokenizeSearchQuery,
  parseSearchToken,
} from "@/utils/tokenize-search-query";
import {
  ThunderbirdReadsProvider,
  boundedTake,
} from "@/utils/thunderbird/provider/reads";
import { ThunderbirdUnsupportedError } from "@/utils/thunderbird/errors";
import { thunderbirdQuerySchema } from "@/utils/thunderbird/types";
export class ThunderbirdSearchProvider extends ThunderbirdReadsProvider {
  async searchMessages(
    options: Parameters<EmailProvider["searchMessages"]>[0],
  ) {
    const query: Record<string, unknown> = {};
    let folderId: string | undefined;
    const words: string[] = [];
    const set = (key: string, value: unknown) => {
      if (key in query && query[key] !== value)
        throw new ThunderbirdUnsupportedError("conflicting search predicates");
      query[key] = value;
    };
    for (const raw of tokenizeSearchQuery(options.query)) {
      const token = parseSearchToken(raw);
      if (
        token.excluded ||
        token.value === "OR" ||
        token.value === "AND" ||
        /[{}()]/.test(raw)
      )
        throw new ThunderbirdUnsupportedError("Boolean search expressions");
      if (!token.operator) {
        words.push(token.value);
        continue;
      }
      if (token.operator === "from") set("author", token.value);
      else if (token.operator === "to") set("recipients", token.value);
      else if (token.operator === "after" || token.operator === "before") {
        const date = new Date(token.value);
        if (!Number.isFinite(date.getTime()))
          throw new Error("Invalid Thunderbird search date");
        set(
          token.operator === "after" ? "fromDate" : "toDate",
          date.toISOString(),
        );
      } else if (
        token.operator === "is" &&
        ["read", "unread", "starred"].includes(token.value)
      )
        set(
          token.value === "starred" ? "flagged" : "read",
          token.value !== "unread",
        );
      else if (token.operator === "has" && token.value === "attachment")
        set("attachment", true);
      else if (token.operator === "in") {
        const role = mailboxRole(token.value);
        if (folderId)
          throw new ThunderbirdUnsupportedError("multiple search folders");
        folderId = await this.systemFolder(role);
      } else if (token.operator === "label") {
        const label = await this.getLabelByName(token.value);
        if (!label) return { messages: [], nextPageToken: undefined };
        if (folderId && folderId !== label.id)
          throw new ThunderbirdUnsupportedError("multiple search folders");
        folderId = label.id;
      } else
        throw new ThunderbirdUnsupportedError(
          `search operator ${token.operator}`,
        );
    }
    if (words.length) set("fullText", words.join(" "));
    if (options.fromEmail) set("author", options.fromEmail);
    if (options.readState) set("read", options.readState === "read");
    if (options.labelIds?.length) {
      if (
        options.labelIds.length !== 1 ||
        (folderId && folderId !== options.labelIds[0])
      )
        throw new ThunderbirdUnsupportedError("multiple label predicates");
      folderId = options.labelIds[0];
    }
    if (options.labelName) {
      const label = await this.getLabelByName(options.labelName);
      if (!label) return { messages: [], nextPageToken: undefined };
      if (folderId && folderId !== label.id)
        throw new ThunderbirdUnsupportedError("multiple search folders");
      folderId = label.id;
    }
    const selectFolder = (id: string) => {
      if (folderId && folderId !== id)
        throw new ThunderbirdUnsupportedError("conflicting search folders");
      folderId = id;
    };
    if (options.folder)
      selectFolder(await this.systemFolder(mailboxRole(options.folder)));
    const mailbox = options.mailboxSearch;
    if (mailbox) {
      if (mailbox.excludedRoles?.length)
        throw new ThunderbirdUnsupportedError("excluded mailbox roles");
      if (mailbox.mailbox !== "all" && mailbox.mailbox !== "starred")
        selectFolder(await this.systemFolder(mailboxRole(mailbox.mailbox)));
      if (mailbox.mailbox === "starred") set("flagged", true);
      if (mailbox.read !== undefined) set("read", mailbox.read);
      if (mailbox.starred !== undefined) set("flagged", mailbox.starred);
      if (mailbox.hasAttachment !== undefined)
        set("attachment", mailbox.hasAttachment);
      if (mailbox.text) {
        if (mailbox.text.field !== "any")
          throw new ThunderbirdUnsupportedError(
            "field-specific mailbox text search",
          );
        set("fullText", mailbox.text.value);
      }
    }
    const page = await this.readPage({
      maxResults: boundedTake(options.maxResults),
      query: thunderbirdQuerySchema.parse(query),
      ...(folderId ? { folderId } : {}),
      ...(options.pageToken ? { pageToken: options.pageToken } : {}),
    });
    const matches = options.fromEmail
      ? page.messages.filter(
          (message) =>
            extractEmailAddress(message.headers.from).toLowerCase() ===
            options.fromEmail!.toLowerCase(),
        )
      : page.messages;
    const messages = [];
    for (const message of matches)
      messages.push(
        message.textPlain === undefined && message.textHtml === undefined
          ? await this.getMessage(message.id)
          : message,
      );
    return { messages, nextPageToken: page.nextPageToken };
  }
  async getMessagesFromSender(
    options: Parameters<EmailProvider["getMessagesFromSender"]>[0],
  ) {
    const dates = [
      options.after ? `after:${options.after.toISOString()}` : "",
      options.before ? `before:${options.before.toISOString()}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return this.searchMessages({
      query: dates,
      fromEmail: options.senderEmail,
      maxResults: options.maxResults,
      pageToken: options.pageToken,
    });
  }
  async getMessagesWithAttachments(
    options: Parameters<EmailProvider["getMessagesWithAttachments"]>[0],
  ) {
    return this.searchMessages({ query: "has:attachment", ...options });
  }
  async countReceivedMessages(senderEmail: string, threshold: number) {
    if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > 25)
      throw new ThunderbirdUnsupportedError("sender count thresholds above 25");
    const page = await this.getMessagesFromSender({
      senderEmail,
      maxResults: 25,
    });
    if (page.nextPageToken && page.messages.length < threshold)
      throw new ThunderbirdUnsupportedError("unbounded sender counts");
    return page.messages.length;
  }
  async hasPreviousCommunicationsWithSenderOrDomain(
    options: Parameters<
      EmailProvider["hasPreviousCommunicationsWithSenderOrDomain"]
    >[0],
  ) {
    const page = await this.getMessagesFromSender({
      senderEmail: extractEmailAddress(options.from),
      before: options.date,
      maxResults: 25,
    });
    if (page.messages.some((message) => message.id !== options.messageId))
      return true;
    if (page.nextPageToken)
      throw new ThunderbirdUnsupportedError("unbounded communication history");
    return false;
  }
  async checkIfReplySent(senderEmail: string) {
    const page = await this.readPage({
      maxResults: 25,
      folderId: await this.systemFolder("SENT"),
      query: { recipients: senderEmail },
    });
    if (
      page.messages.some((message) =>
        message.headers.to
          .split(",")
          .some(
            (to) =>
              extractEmailAddress(to).toLowerCase() ===
              senderEmail.toLowerCase(),
          ),
      )
    )
      return true;
    if (page.nextPageToken)
      throw new ThunderbirdUnsupportedError("unbounded sent history");
    return false;
  }
}
function mailboxRole(name: string) {
  const role: Record<string, string> = {
    inbox: "INBOX",
    sent: "SENT",
    drafts: "DRAFT",
    draft: "DRAFT",
    spam: "SPAM",
    junk: "SPAM",
    trash: "TRASH",
    archive: "ARCHIVE",
  };
  if (!role[name]) throw new ThunderbirdUnsupportedError(`mailbox ${name}`);
  return role[name];
}
