import { z } from "zod";

export const connectSmarterMailBody = z.object({
  baseUrl: z.string().url(),
  username: z
    .string()
    .email()
    .transform((value) => value.trim().toLowerCase()),
  password: z.string().min(1).max(1024),
  twoFactorCode: z.string().trim().max(32).optional(),
});
export type ConnectSmarterMailBody = z.infer<typeof connectSmarterMailBody>;
