import { z } from "zod";
import type { SmarterMailClient } from "@/utils/smartermail/client";
import { InvalidMailboxSyncCursorError } from "@/utils/email/mailbox-sync";

const maximumOffset = 2_147_383_647;
const cursorSchema = z.object({
  scope: z.string().min(1),
  folderId: z.string().min(1),
  guid: z.string().optional(),
  skip: z.number().int().min(0).max(maximumOffset),
});
const uidPageSchema = z.object({
  success: z.literal(true),
  totalCount: z.number().int().min(0).max(maximumOffset),
  results: z
    .array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
    .max(1000),
});

export async function fetchSmarterMailStatsUids({
  client,
  scope,
  folderId,
  guid,
  pageToken,
  maxResults = 1000,
}: {
  client: Pick<SmarterMailClient, "request">;
  scope: string;
  folderId: string;
  guid?: string;
  pageToken?: string;
  maxResults?: number;
}) {
  if (
    !scope ||
    !folderId ||
    !Number.isSafeInteger(maxResults) ||
    maxResults < 1 ||
    maxResults > 1000
  )
    throw new Error("Invalid SmarterMail UID inventory request");
  let skip = 0;
  if (pageToken) {
    try {
      if (!pageToken.startsWith("sm-uids:") || pageToken.length > 8192)
        throw new InvalidMailboxSyncCursorError();
      const cursor = cursorSchema.parse(
        JSON.parse(
          Buffer.from(pageToken.slice(8), "base64url").toString("utf8"),
        ),
      );
      if (
        cursor.scope !== scope ||
        cursor.folderId !== folderId ||
        cursor.guid !== guid
      )
        throw new InvalidMailboxSyncCursorError();
      skip = cursor.skip;
    } catch {
      throw new InvalidMailboxSyncCursorError();
    }
  }
  const page = uidPageSchema.parse(
    await client.request("messagesUid", {
      folder: folderId,
      query: "",
      includeSubFolders: false,
      skip,
      take: maxResults,
    }),
  );
  if (skip > page.totalCount) throw new InvalidMailboxSyncCursorError();
  const nextOffset = skip + page.results.length;
  if (
    page.results.length > maxResults ||
    new Set(page.results).size !== page.results.length ||
    nextOffset > page.totalCount ||
    (page.results.length === 0 && skip < page.totalCount)
  )
    throw new Error("Inconclusive SmarterMail UID inventory page");
  return {
    uids: page.results,
    total: page.totalCount,
    nextPageToken:
      nextOffset < page.totalCount
        ? `sm-uids:${Buffer.from(JSON.stringify({ scope, folderId, guid, skip: nextOffset })).toString("base64url")}`
        : undefined,
  };
}
