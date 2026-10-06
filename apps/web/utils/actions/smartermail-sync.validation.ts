import { z } from "zod";

export const retrySmarterMailSyncBody = z.object({
  messageId: z.string().min(1).max(2048),
});
