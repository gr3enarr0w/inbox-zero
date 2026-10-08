import { z } from "zod";
import type { SmarterMailClient } from "@/utils/smartermail/client";
import {
  normalizeSmarterMailMessage,
  parseSmarterMailMessageId,
  smarterMailMessageId,
} from "@/utils/smartermail/message";

const addressSchema = z.object({
  email: z.string().email(),
  name: z.string().nullable().optional(),
});
const metadataSchema = z.object({
  success: z.literal(true),
  results: z
    .array(
      z.object({
        uid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        folder: z.string().min(1),
        subject: z.string(),
        from: addressSchema,
        internalDate: z
          .string()
          .min(1)
          .refine((value) => Number.isFinite(new Date(value).getTime())),
        dateSent: z.string().optional(),
        recipients: z.array(addressSchema),
        isSeen: z.boolean().optional(),
        isFlagged: z.boolean().optional(),
        categories: z.array(z.string()).optional(),
        hasAttachments: z.boolean().optional(),
      }),
    )
    .max(20),
});

export class SmarterMailStatsMetadataInconclusiveError extends Error {
  constructor() {
    super("SmarterMail statistics metadata could not be validated");
    this.name = "SmarterMailStatsMetadataInconclusiveError";
  }
}

export async function fetchSmarterMailStatsMessages(
  client: Pick<SmarterMailClient, "request">,
  messageIds: string[],
) {
  if (messageIds.length > 20 || new Set(messageIds).size !== messageIds.length)
    throw new Error(
      "SmarterMail statistics metadata requires at most 20 unique IDs",
    );
  const references = messageIds.map(parseSmarterMailMessageId);
  if (!references.length) return [];
  const parsed = metadataSchema.safeParse(
    await client.request("messageMetadata", {
      messages: references.map((reference) => ({
        ...reference,
        needLocation: false,
        isNew: false,
      })),
    }),
  );
  if (!parsed.success) throw new SmarterMailStatsMetadataInconclusiveError();
  const response = parsed.data;
  const requested = new Set(messageIds);
  const messages = new Map<
    string,
    ReturnType<typeof normalizeSmarterMailMessage>
  >();
  for (const row of response.results) {
    const id = smarterMailMessageId(row.folder, row.uid);
    if (!requested.has(id) || messages.has(id))
      throw new SmarterMailStatsMetadataInconclusiveError();
    messages.set(
      id,
      normalizeSmarterMailMessage(
        {
          messageData: {
            ...row,
            from: {
              email: row.from.email,
              ...(row.from.name ? { name: row.from.name } : {}),
            },
            to: row.recipients
              .map((address) =>
                address.name
                  ? `${address.name} <${address.email}>`
                  : address.email,
              )
              .join(", "),
          },
        },
        row.folder,
        row.uid,
      ),
    );
  }
  if (messages.size !== requested.size)
    throw new SmarterMailStatsMetadataInconclusiveError();
  return messageIds.map((id) => messages.get(id)!);
}
