import { isValidEmail } from "@/utils/email";
import {
  parseSearchToken,
  tokenizeSearchQuery,
} from "@/utils/tokenize-search-query";
import { SmarterMailUnsupportedError } from "@/utils/smartermail/provider/error";

type SearchFilters = {
  query: string;
  role?: string;
  category?: string;
  fromEmail?: string;
  read?: boolean;
  starred?: boolean;
  hasAttachment?: boolean;
  after?: Date;
  before?: Date;
};

export function compileSmarterMailSearch(
  query: string,
  now = new Date(),
): SearchFilters {
  const filters: SearchFilters = { query: "" };
  const text: string[] = [];
  if ((query.match(/"/g)?.length ?? 0) % 2)
    throw new SmarterMailUnsupportedError("unclosed search quotes");
  for (const token of tokenizeSearchQuery(query)) {
    const { operator, value, excluded } = parseSearchToken(token);
    if (
      excluded ||
      ["OR", "AND", "NOT"].includes(token) ||
      /[{}()]/.test(token)
    )
      throw new SmarterMailUnsupportedError(
        "compound or excluded search filters",
      );
    if (!operator) {
      text.push(token);
      continue;
    }
    if (!value) throw new Error("SmarterMail search filter requires a value");
    switch (operator) {
      case "in": {
        const role = {
          inbox: "INBOX",
          sent: "SENT",
          drafts: "DRAFT",
          archive: "ARCHIVE",
          spam: "SPAM",
          trash: "TRASH",
        }[value.toLowerCase()];
        if (!role)
          throw new SmarterMailUnsupportedError("mailbox search scope");
        setFilter(filters, "role", role);
        break;
      }
      case "label":
        setFilter(filters, "category", value);
        break;
      case "from":
        if (!isValidEmail(value))
          throw new SmarterMailUnsupportedError(
            "sender search without an exact email address",
          );
        setFilter(filters, "fromEmail", value);
        break;
      case "is":
        if (value === "read" || value === "unread")
          setFilter(filters, "read", value === "read");
        else if (value === "starred") setFilter(filters, "starred", true);
        else throw new SmarterMailUnsupportedError("message state search");
        break;
      case "has":
        if (value !== "attachment")
          throw new SmarterMailUnsupportedError("message attribute search");
        setFilter(filters, "hasAttachment", true);
        break;
      case "after":
      case "before":
        setFilter(filters, operator, parseSearchDate(value));
        break;
      case "newer_than":
      case "older_than": {
        const match = /^(\d+)([dmy])$/.exec(value);
        if (
          !match ||
          !Number.isSafeInteger(Number(match[1])) ||
          Number(match[1]) < 1
        )
          throw new Error("Invalid SmarterMail relative search date");
        const date = new Date(now);
        const amount = Number(match[1]);
        if (match[2] === "d") date.setUTCDate(date.getUTCDate() - amount);
        else if (match[2] === "m")
          date.setUTCMonth(date.getUTCMonth() - amount);
        else date.setUTCFullYear(date.getUTCFullYear() - amount);
        if (!Number.isFinite(date.getTime()))
          throw new Error("Invalid SmarterMail relative search date");
        setFilter(
          filters,
          operator === "newer_than" ? "after" : "before",
          date,
        );
        break;
      }
      default:
        throw new SmarterMailUnsupportedError(`search operator ${operator}`);
    }
  }
  if (filters.after && filters.before && filters.after >= filters.before)
    throw new Error("Invalid SmarterMail search date range");
  filters.query = text.join(" ");
  return filters;
}

function setFilter<K extends keyof SearchFilters>(
  filters: SearchFilters,
  key: K,
  value: SearchFilters[K],
) {
  const existing = filters[key];
  if (existing !== undefined && String(existing) !== String(value))
    throw new Error("Conflicting SmarterMail search filters");
  filters[key] = value;
}

function parseSearchDate(value: string) {
  const match = /^(\d{4})[/-](\d{2})[/-](\d{2})$/.exec(value);
  if (!match) throw new Error("Invalid SmarterMail search date");
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() + 1 !== Number(match[2]) ||
    date.getUTCDate() !== Number(match[3])
  )
    throw new Error("Invalid SmarterMail search date");
  return date;
}
