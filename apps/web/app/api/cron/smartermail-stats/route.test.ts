import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { createEmailProvider } from "@/utils/email/provider";
import { loadEmails } from "@/utils/actions/stats-loading";
import { GET } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/prisma");
vi.mock("@/env", () => ({ env: { CRON_SECRET: "test-cron-secret" } }));
vi.mock("@/utils/email/provider", () => ({ createEmailProvider: vi.fn() }));
vi.mock("@/utils/actions/stats-loading", () => ({ loadEmails: vi.fn() }));
vi.mock("@/utils/middleware", async () => {
  const { createWithErrorTestMiddleware } = await vi.importActual<
    typeof import("@/__tests__/helpers")
  >("@/__tests__/helpers");
  return createWithErrorTestMiddleware();
});

const tick = () =>
  GET(
    new Request("http://localhost/api/cron/smartermail-stats", {
      headers: { authorization: "Bearer test-cron-secret" },
    }),
  );
let states: Array<{
  emailAccountId: string;
  failures: number;
  nextRunAt: Date;
  updatedAt: Date;
  leaseUntil: Date | null;
  importError?: string;
}>;

describe("SmarterMail statistics cron initialization backoff", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    states = ["broken", "healthy"].map((emailAccountId, index) => ({
      emailAccountId,
      failures: index ? 0 : 2,
      nextRunAt: new Date(0),
      updatedAt: new Date(index),
      leaseUntil: null,
    }));
    prisma.smarterMailStatsImportState.findFirst.mockImplementation(
      async () =>
        states.find(
          (state) =>
            state.nextRunAt <= new Date() &&
            (!state.leaseUntil || state.leaseUntil <= new Date()),
        ) as never,
    );
    prisma.smarterMailStatsImportState.updateMany.mockImplementation(
      async ({ where, data }) => {
        const state = states.find(
          (row) => row.emailAccountId === where.emailAccountId,
        );
        if (
          !state ||
          state.updatedAt.getTime() !== (where.updatedAt as Date).getTime() ||
          (state.leaseUntil && state.leaseUntil > new Date())
        )
          return { count: 0 };
        state.nextRunAt = data.nextRunAt as Date;
        state.importError = data.importError as string;
        state.failures++;
        state.updatedAt = data.updatedAt as Date;
        return { count: 1 };
      },
    );
    vi.mocked(createEmailProvider).mockRejectedValueOnce(
      new Error("private credentials must not be stored"),
    );
    vi.mocked(createEmailProvider).mockResolvedValueOnce({
      name: "smartermail",
    } as never);
    vi.mocked(loadEmails).mockResolvedValue({ complete: false } as never);
  });

  it("backs off a broken account and services the next due account", async () => {
    const started = Date.now();
    const failed = await tick();
    expect(failed.status).toBe(503);
    expect(states[0].nextRunAt.getTime()).toBeGreaterThanOrEqual(
      started + 240_000,
    );
    expect(states[0].failures).toBe(3);
    expect(states[0].importError).not.toContain("private credentials");
    expect(await failed.text()).not.toContain("private credentials");
    expect((await tick()).status).toBe(200);
    expect(loadEmails).toHaveBeenCalledWith(
      expect.objectContaining({ emailAccountId: "healthy" }),
      { loadBefore: false, maxPages: 1 },
    );
  });

  it("does not alter an account acquired by an importer during provider initialization", async () => {
    vi.mocked(createEmailProvider)
      .mockReset()
      .mockImplementation(async () => {
        states[0].leaseUntil = new Date(Date.now() + 180_000);
        throw new Error("Connection failed");
      });
    expect((await tick()).status).toBe(503);
    expect(states[0]).toMatchObject({ failures: 2, nextRunAt: new Date(0) });
    expect(states[0].importError).toBeUndefined();
    expect(prisma.smarterMailStatsImportState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          emailAccountId: "broken",
          nextRunAt: new Date(0),
          updatedAt: new Date(0),
          OR: [{ leaseUntil: null }, { leaseUntil: { lte: expect.any(Date) } }],
        }),
      }),
    );
  });
});
