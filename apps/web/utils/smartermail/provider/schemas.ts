import { z } from "zod";
export const listingSchema = z.object({
  results: z.array(
    z.object({ uid: z.number().int().positive() }).passthrough(),
  ),
  totalCount: z.number().optional(),
});
export const folderSchema = z
  .object({
    path: z.string().optional(),
    name: z.string().optional(),
    folder: z.string().optional(),
    unread: z.number().optional(),
    totalMessages: z.number().optional(),
  })
  .passthrough();
export const categorySettingsSchema = z.object({
  defaultCategory: z.string().optional(),
  categories: z.array(
    z.object({ name: z.string(), colorIndex: z.number(), guid: z.string() }),
  ),
});
