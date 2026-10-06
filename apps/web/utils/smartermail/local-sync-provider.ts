import type { EmailProvider } from "@/utils/email/types";
import { withSmarterMailLocalSyncContext } from "@/utils/smartermail/local-sync-context";

const scopedReads = new Set([
  "getFolders",
  "getMailboxSyncPage",
  "getMessage",
  "getMessagesWithPagination",
  "searchMessages",
  "getThread",
  "getThreadMessages",
  "getAttachmentStream",
]);

export function scopedLocalSyncProvider(
  provider: EmailProvider,
  emailAccountId: string,
): EmailProvider {
  if (provider.name !== "smartermail") return provider;
  return new Proxy(provider, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      if (typeof property !== "string" || !scopedReads.has(property))
        return value.bind(target);
      return (...args: unknown[]) =>
        withSmarterMailLocalSyncContext(emailAccountId, "current", async () =>
          Reflect.apply(value, target, args),
        );
    },
  });
}
