import { describe, expect, it, vi } from "vitest";
import {
  StatsLoader,
  isStatsImportCacheKey,
  type StatLoaderState,
} from "./stat-loader";

function page(complete: boolean, pages = 1) {
  return {
    data: {
      pages,
      loadedAfterMessages: 2,
      loadedBeforeMessages: 0,
      hasMoreAfter: !complete,
      hasMoreBefore: false,
      complete,
      totalImported: 7,
    },
  };
}
function fixture(loadPage = vi.fn().mockResolvedValue(page(true))) {
  const states: Record<string, Partial<StatLoaderState>> = {};
  const loader = new StatsLoader(loadPage, (account, update) => {
    states[account] = { ...states[account], ...update };
  });
  return { loader, loadPage, states };
}
describe("email stats import controller", () => {
  it("publishes safe-action failure instead of empty success and releases loading for retry", async () => {
    const { loader, states } = fixture(
      vi
        .fn()
        .mockResolvedValueOnce({ serverError: "Unsupported" })
        .mockResolvedValueOnce(page(true)),
    );
    expect(await loader.load("a", false, 50)).toBe(false);
    expect(states.a).toMatchObject({
      isLoading: false,
      error: expect.any(String),
    });
    expect(states.a.progress).toBeUndefined();
    expect(await loader.load("a", false)).toBe(true);
    expect(states.a).toMatchObject({
      isLoading: false,
      error: null,
      progress: { complete: true, imported: 7 },
    });
  });
  it("retains partial progress after a later page fails and stops the batch", async () => {
    const { loader, loadPage, states } = fixture(
      vi
        .fn()
        .mockResolvedValueOnce(page(false))
        .mockRejectedValueOnce(new Error("private network details")),
    );
    expect(await loader.load("a", false, 50)).toBe(false);
    expect(loadPage).toHaveBeenCalledTimes(2);
    expect(states.a).toMatchObject({
      isLoading: false,
      error: expect.any(String),
      progress: { complete: false, imported: 7 },
    });
    expect(states.a.error).not.toContain("private");
  });
  it("stops at genuine completion and coalesces concurrent requests for the same account", async () => {
    const { loader, loadPage } = fixture();
    const first = loader.load("a", false, 50);
    expect(loader.load("a", false, 50)).toBe(first);
    expect(await first).toBe(true);
    expect(loadPage).toHaveBeenCalledTimes(1);
  });
  it("keeps empty intermediate pages incomplete when a cursor remains", async () => {
    const { loader, states } = fixture(
      vi.fn().mockResolvedValue(page(false, 0)),
    );
    expect(await loader.load("a", false, 50)).toBe(false);
    expect(states.a.progress?.complete).toBe(false);
  });
  it("cancels subsequent pages while preserving the completed page's partial progress", async () => {
    const pending = Promise.withResolvers<ReturnType<typeof page>>();
    const { loader, loadPage, states } = fixture(
      vi.fn().mockReturnValue(pending.promise),
    );
    const run = loader.load("a", false, 50);
    await Promise.resolve();
    loader.cancel("a");
    pending.resolve(page(false));
    expect(await run).toBe(false);
    expect(loadPage).toHaveBeenCalledTimes(1);
    expect(states.a.isLoading).toBe(false);
  });
  it("isolates independent account imports", async () => {
    const waiting = Promise.withResolvers<ReturnType<typeof page>>();
    const { loader, states } = fixture(
      vi
        .fn()
        .mockImplementation((id: string) =>
          id === "a" ? waiting.promise : Promise.resolve(page(true)),
        ),
    );
    const a = loader.load("a", false);
    await loader.load("b", false);
    expect(states.b.progress?.complete).toBe(true);
    expect(states.a.isLoading).toBe(true);
    waiting.resolve(page(false));
    await a;
    expect(states.a.progress?.complete).toBe(false);
    expect(states.b.progress?.complete).toBe(true);
  });
  it("allows retry after an action throws synchronously", async () => {
    const { loader, loadPage } = fixture(
      vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error("failure");
        })
        .mockResolvedValueOnce(page(true)),
    );
    expect(await loader.load("a", false)).toBe(false);
    expect(await loader.load("a", false)).toBe(true);
    expect(loadPage).toHaveBeenCalledTimes(2);
  });
});

it("revalidates only imported stats keys in the current mailbox scope", () => {
  expect(
    isStatsImportCacheKey("/api/user/stats/senders?fromDate=2026-01-01", "a"),
  ).toBe(true);
  expect(isStatsImportCacheKey(["/api/user/stats/by-period", "a"], "a")).toBe(
    true,
  );
  expect(isStatsImportCacheKey(["/api/user/stats/by-period", "b"], "a")).toBe(
    false,
  );
  expect(
    isStatsImportCacheKey("/api/user/stats/senders?emailAccountId=b", "a"),
  ).toBe(false);
  expect(
    isStatsImportCacheKey("/api/user/categorize/senders/categorized", "a"),
  ).toBe(true);
  expect(isStatsImportCacheKey("/api/user/stats/rule-stats", "a")).toBe(false);
  expect(
    isStatsImportCacheKey("/api/user/stats/newsletters?filter=all", "a"),
  ).toBe(true);
  expect(
    isStatsImportCacheKey(["/api/user/stats/newsletters/summary", "a"], "a"),
  ).toBe(true);
  expect(
    isStatsImportCacheKey("/api/user/stats/sender-emails/?sender=fixture", "a"),
  ).toBe(true);
  expect(isStatsImportCacheKey(["/api/user/stats/newsletters", "b"], "a")).toBe(
    false,
  );
});
