import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { getThunderbirdClientForEmail } from "./account";

const mocks = vi.hoisted(() => ({ client: vi.fn(), readAccount: vi.fn() }));
vi.mock("@/utils/prisma");
vi.mock("./config", () => ({
  getThunderbirdConfig: () => ({
    baseUrl: "http://localhost:8787",
    token: "private-test",
    ownerEmail: "owner@example.com",
  }),
}));
vi.mock("./client", () => ({
  ThunderbirdClient: class {
    readAccount = mocks.readAccount;
    constructor(options: unknown) {
      mocks.client(options);
    }
  },
}));
const bound = {
  userId: "owner",
  email: "school@example.com",
  user: { email: "OWNER@example.com" },
  account: {
    userId: "owner",
    provider: "thunderbird",
    thunderbirdAccountId: "account1",
    disconnectedAt: null,
  },
};
describe("Thunderbird account client isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readAccount.mockResolvedValue({
      account: { ready: true, inboxFound: true },
    });
  });
  it("scopes user lookup and pins native ID plus mailbox email", async () => {
    prisma.emailAccount.findFirst.mockResolvedValue(bound as never);
    await getThunderbirdClientForEmail({
      emailAccountId: "mailbox",
      userId: "owner",
    });
    expect(prisma.emailAccount.findFirst.mock.calls[0][0]?.where).toEqual({
      id: "mailbox",
      userId: "owner",
    });
    expect(mocks.client).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "account1",
        expectedEmail: "school@example.com",
      }),
    );
  });
  it.each([
    null,
    { ...bound, user: { email: "other@example.com" } },
    { ...bound, account: { ...bound.account, userId: "other" } },
    { ...bound, account: { ...bound.account, provider: "microsoft" } },
    { ...bound, account: { ...bound.account, disconnectedAt: new Date() } },
  ])("rejects unavailable or conflicting ownership before client creation", async (record) => {
    prisma.emailAccount.findFirst.mockResolvedValue(record as never);
    await expect(
      getThunderbirdClientForEmail({ emailAccountId: "mailbox" }),
    ).rejects.toThrow("not available");
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("rejects a native session whose bound identity or readiness no longer matches", async () => {
    prisma.emailAccount.findFirst.mockResolvedValue(bound as never);
    mocks.readAccount.mockRejectedValue(
      new Error("Thunderbird bridge mailbox scope mismatch"),
    );
    await expect(
      getThunderbirdClientForEmail({ emailAccountId: "mailbox" }),
    ).rejects.toThrow("scope mismatch");
    mocks.readAccount.mockResolvedValue({
      account: { ready: false, inboxFound: true },
    });
    await expect(
      getThunderbirdClientForEmail({ emailAccountId: "mailbox" }),
    ).rejects.toThrow("not ready");
  });
});
