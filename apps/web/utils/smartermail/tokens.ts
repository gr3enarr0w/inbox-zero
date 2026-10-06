import { z } from "zod";
import { SmarterMailApiError } from "./errors";

export type SmarterMailTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt?: number;
};

export const authenticationSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
});

export function assertSmarterMailSuccess(payload: unknown) {
  if (isObject(payload) && payload.success === false) {
    throw new SmarterMailApiError("SmarterMail operation was rejected");
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function getTokenExpiry(accessToken: string): number | undefined {
  try {
    // This is a refresh hint, not JWT verification or an authentication decision.
    const payload = JSON.parse(
      Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"),
    );
    const exp = payload?.exp;
    return typeof exp === "number" && Number.isFinite(exp) && exp > 0
      ? exp * 1000
      : undefined;
  } catch {
    return;
  }
}
