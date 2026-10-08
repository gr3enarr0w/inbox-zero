import { env } from "@/env";
import { SafeError } from "@/utils/error";

export function getThunderbirdConfig() {
  const baseUrl = env.THUNDERBIRD_BRIDGE_URL;
  const token = env.THUNDERBIRD_BRIDGE_TOKEN;
  const ownerEmail = env.THUNDERBIRD_BRIDGE_OWNER_EMAIL;
  if (!baseUrl || !token || !ownerEmail) return null;
  const url = new URL(baseUrl);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(token)
  )
    throw new SafeError("The Thunderbird bridge configuration is invalid.");
  return { baseUrl: url.origin, token, ownerEmail: ownerEmail.toLowerCase() };
}

export function isThunderbirdOwner(email: string | null | undefined) {
  const config = getThunderbirdConfig();
  return Boolean(config && email?.toLowerCase() === config.ownerEmail);
}
