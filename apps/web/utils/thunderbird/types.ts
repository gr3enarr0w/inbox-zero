import { z } from "zod";

export const thunderbirdIdentitySchema = z.object({
  headerMessageId: z.string().min(1).max(2048),
  date: z.iso.datetime({ offset: true }),
  subject: z.string().max(8192),
});
export const thunderbirdMessageSchema = thunderbirdIdentitySchema.extend({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  folderId: z.string().min(1).max(2048),
  from: z.string().max(8192),
  to: z.array(z.string().max(8192)).max(50),
  read: z.boolean(),
  flagged: z.boolean(),
  hasAttachments: z.boolean(),
  textPlain: z.string().optional(),
  textHtml: z.string().optional(),
  inReplyTo: z.string().max(8192).optional(),
  references: z.string().max(16_384).optional(),
  replyTo: z.string().max(8192).optional(),
});
export const thunderbirdFolderSchema = z.object({
  id: z.string().min(1).max(2048),
  name: z.string().min(1).max(2048),
  path: z.string().max(4096),
  specialUse: z.array(z.string()).max(20),
  isRoot: z.boolean().optional(),
  total: z.number().int().nonnegative().optional(),
  unread: z.number().int().nonnegative().optional(),
});
export const thunderbirdQuerySchema = z.strictObject({
  headerMessageId: z.string().min(1).max(2048).optional(),
  author: z.string().max(2048).optional(),
  recipients: z.string().max(2048).optional(),
  fullText: z.string().max(2048).optional(),
  read: z.boolean().optional(),
  flagged: z.boolean().optional(),
  attachment: z.boolean().optional(),
  fromDate: z.iso.datetime({ offset: true }).optional(),
  toDate: z.iso.datetime({ offset: true }).optional(),
});
const messageId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const operationId = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const identity = thunderbirdIdentitySchema;
export const thunderbirdCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("readAccount") }),
  z.strictObject({ type: z.literal("listFolders") }),
  z.strictObject({
    type: z.literal("listMessages"),
    folderId: z.string().min(1).optional(),
    maxResults: z.number().int().min(1).max(25),
    pageToken: z.string().min(1).max(4096).optional(),
    query: thunderbirdQuerySchema.optional(),
  }),
  z.strictObject({
    type: z.literal("getMessage"),
    messageId,
    identity: identity.optional(),
  }),
  z.strictObject({
    type: z.literal("moveMessage"),
    messageId,
    destinationFolderId: z.string().min(1),
    identity,
    operationId,
  }),
  z.strictObject({
    type: z.literal("updateMessage"),
    messageId,
    read: z.boolean().optional(),
    flagged: z.boolean().optional(),
    identity,
    operationId,
  }),
  z.strictObject({
    type: z.literal("createFolder"),
    name: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[^/\\]+$/),
    parentFolderId: z.string().min(1).optional(),
    operationId,
  }),
  z.strictObject({
    type: z.literal("createDraft"),
    replyToId: messageId.optional(),
    identity: identity.optional(),
    to: z.array(z.string().min(1).max(8192)).min(1).max(50),
    subject: z.string().max(8192),
    textPlain: z.string().max(200_000),
    operationId,
  }),
]);
export type ThunderbirdOperation = z.infer<
  typeof thunderbirdCommandSchema
>["type"];
export type ThunderbirdMessage = z.infer<typeof thunderbirdMessageSchema>;
