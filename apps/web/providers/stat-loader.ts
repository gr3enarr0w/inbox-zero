import type { LoadEmailStatsResponse } from "@/app/api/user/stats/load/route";

export type StatLoaderState = {
  isLoading: boolean;
  error: string | null;
  progress: { complete: boolean; imported: number } | null;
};

type LoadPage = (
  emailAccountId: string,
  input: { loadBefore: boolean },
) => Promise<
  | {
      data?: LoadEmailStatsResponse;
      serverError?: string;
      validationErrors?: unknown;
    }
  | undefined
>;

type UpdateState = (accountId: string, state: Partial<StatLoaderState>) => void;

export class StatsLoader {
  readonly #pending = new Map<string, Promise<boolean>>();
  readonly #cancelled = new Set<string>();
  readonly #loadPage: LoadPage;
  readonly #update: UpdateState;
  constructor(loadPage: LoadPage, update: UpdateState) {
    this.#loadPage = loadPage;
    this.#update = update;
  }

  load(accountId: string, loadBefore: boolean, maxPages = 1) {
    const pending = this.#pending.get(accountId);
    if (pending) return pending;
    this.#cancelled.delete(accountId);
    const operation = Promise.resolve().then(() =>
      this.run(accountId, loadBefore, maxPages),
    );
    this.#pending.set(accountId, operation);
    return operation;
  }

  cancel(accountId: string) {
    this.#cancelled.add(accountId);
  }

  cancelOtherAccounts(accountId: string) {
    for (const pendingAccount of this.#pending.keys()) {
      if (pendingAccount !== accountId) this.cancel(pendingAccount);
    }
  }

  private async run(accountId: string, loadBefore: boolean, maxPages: number) {
    this.#update(accountId, { isLoading: true, error: null });
    let imported = 0;
    try {
      for (let page = 0; page < maxPages; page++) {
        if (this.#cancelled.has(accountId)) break;
        const response = await this.#loadPage(accountId, { loadBefore });
        if (
          !response?.data ||
          response.serverError ||
          response.validationErrors
        )
          throw new Error("Import failed");
        const data = response.data;
        if ("importError" in data && data.importError)
          throw new Error("Import failed");
        imported += data.loadedAfterMessages + data.loadedBeforeMessages;
        const complete =
          "complete" in data
            ? Boolean(data.complete)
            : !data.hasMoreAfter && !data.hasMoreBefore;
        const progress = {
          complete,
          imported:
            "totalImported" in data ? Number(data.totalImported) : imported,
        };
        this.#update(accountId, { progress });
        if (complete) return true;
        if (!data.pages) break;
      }
      return false;
    } catch {
      this.#update(accountId, {
        error: "Email import failed. Existing counts may be incomplete.",
      });
      return false;
    } finally {
      this.#pending.delete(accountId);
      this.#cancelled.delete(accountId);
      this.#update(accountId, { isLoading: false });
    }
  }
}

export function isStatsImportCacheKey(key: unknown, emailAccountId: string) {
  if (Array.isArray(key) && (key.length !== 2 || key[1] !== emailAccountId))
    return false;
  const url = Array.isArray(key) ? key[0] : key;
  if (typeof url !== "string") return false;
  const [pathname, query] = url.split("?");
  const targetAccount = new URLSearchParams(query).get("emailAccountId");
  if (targetAccount && targetAccount !== emailAccountId) return false;
  return [
    "/api/user/stats/senders",
    "/api/user/stats/recipients",
    "/api/user/stats/by-period",
    "/api/user/categorize/senders/categorized",
    "/api/user/stats/newsletters",
    "/api/user/stats/newsletters/summary",
    "/api/user/stats/sender-emails",
  ].includes(pathname.replace(/\/$/, ""));
}
