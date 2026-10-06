import { AsyncLocalStorage } from "node:async_hooks";

const context = new AsyncLocalStorage<{
  emailAccountId: string;
  priority: "backfill" | "current";
  signal: AbortSignal;
}>();

export function getSmarterMailLocalSyncContext() {
  return context.getStore();
}

export function withSmarterMailLocalSyncContext<T>(
  emailAccountId: string,
  priority: "backfill" | "current",
  operation: () => Promise<T>,
) {
  const existing = context.getStore();
  if (existing) {
    if (existing.emailAccountId !== emailAccountId)
      throw new Error("SmarterMail local sync account scope mismatch");
    return operation();
  }
  return context.run(
    { emailAccountId, priority, signal: AbortSignal.timeout(60_000) },
    operation,
  );
}
