import { createHash } from "node:crypto";
import { z } from "zod";
import type { SmarterMailClient } from "@/utils/smartermail/client";
import { listingSchema } from "@/utils/smartermail/provider/schemas";

const cursorSchema = z.object({
  fingerprint: z.string(),
  index: z.number().int().nonnegative(),
  skip: z.number().int().nonnegative().max(2_147_383_647),
});

export async function fetchSmarterMailFolderPage({
  client,
  folders,
  body,
  take,
  pageToken,
  scope,
  signal,
}: {
  client: Pick<SmarterMailClient, "request">;
  folders: string[];
  body: Record<string, unknown>;
  take: number;
  pageToken?: string;
  scope: string;
  signal?: AbortSignal;
}) {
  signal?.throwIfAborted();
  if (!Number.isInteger(take) || take < 1 || take > 25)
    throw new Error("SmarterMail page size must be between 1 and 25");
  if (!scope || folders.some((folder) => !folder))
    throw new Error("Invalid SmarterMail folder scope");
  const inventory = [...new Set(folders)].sort();
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(canonical({ scope, folders: inventory, body })))
    .digest("hex");
  let index = 0;
  let skip = 0;
  if (pageToken) {
    if (!pageToken.startsWith("sm-folders:"))
      throw new Error("Invalid SmarterMail global page token");
    const cursor = cursorSchema.parse(
      JSON.parse(
        Buffer.from(pageToken.slice(11), "base64url").toString("utf8"),
      ),
    );
    if (cursor.fingerprint !== fingerprint || cursor.index >= inventory.length)
      throw new Error(
        "SmarterMail global page scope changed; restart the query",
      );
    ({ index, skip } = cursor);
  }
  const results: Array<
    z.infer<typeof listingSchema>["results"][number] & { folder: string }
  > = [];
  let folderRequests = 0;
  while (
    index < inventory.length &&
    results.length < take &&
    folderRequests < 20
  ) {
    signal?.throwIfAborted();
    const folder = inventory[index]!;
    const remaining = take - results.length;
    folderRequests++;
    const page = listingSchema.parse(
      await client.request("search", {
        ...body,
        folder,
        includeSubFolders: false,
        skip,
        take: remaining,
      }),
    );
    if (page.results.length > remaining)
      throw new Error("SmarterMail returned more than the requested page size");
    for (const row of page.results) {
      if (row.folder !== undefined && row.folder !== folder)
        throw new Error("SmarterMail search result folder scope mismatch");
      results.push({ ...row, folder });
    }
    if (page.results.length < remaining) {
      index++;
      skip = 0;
    } else {
      skip += page.results.length;
      if (!Number.isSafeInteger(skip) || skip > 2_147_383_647)
        throw new Error("SmarterMail folder pagination limit exceeded");
    }
  }
  return {
    results,
    nextPageToken:
      index < inventory.length
        ? `sm-folders:${Buffer.from(JSON.stringify({ fingerprint, index, skip })).toString("base64url")}`
        : undefined,
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, canonical(child)]),
    );
  return value;
}
