import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { getSmarterMailClientForEmail } from "@/utils/smartermail/account";

const { constructed } = vi.hoisted(() => ({ constructed: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/utils/prisma");
vi.mock("@/env", () => ({
  env: { SMARTERMAIL_ALLOWED_ORIGINS: "https://mail.example.com" },
}));
vi.mock("@/utils/smartermail/client", () => ({
  SmarterMailClient: class {
    constructor(options: unknown) {
      constructed(options);
    }
  },
}));

describe("SmarterMail account isolation", () => {
  beforeEach(() => vi.clearAllMocks());
  it("requires an active provider account belonging to the requested user", async () => {
    prisma.emailAccount.findFirst.mockResolvedValue(null);
    await expect(
      getSmarterMailClientForEmail({
        emailAccountId: "mailbox-a",
        userId: "user-b",
      }),
    ).rejects.toThrow("disconnected");
    expect(prisma.emailAccount.findFirst).toHaveBeenCalledWith({
      where: {
        id: "mailbox-a",
        userId: "user-b",
        account: { provider: "smartermail", disconnectedAt: null },
      },
      include: { account: true },
    });
    expect(constructed).not.toHaveBeenCalled();
  });
  it("persists rotated credentials only against the original active account", async () => {
    prisma.emailAccount.findFirst.mockResolvedValue({
      account: {
        id: "account-a",
        userId: "user-a",
        smarterMailBaseUrl: "https://mail.example.com",
        access_token: "access-a",
        refresh_token: "refresh-a",
        expires_at: null,
        updatedAt: new Date(1000),
      },
    } as never);
    prisma.account.updateMany.mockResolvedValue({ count: 1 });
    await getSmarterMailClientForEmail({ emailAccountId: "mailbox-a" });
    const options = constructed.mock.calls[0][0];
    expect(options.tokens.accessToken).toBe("access-a");
    await options.onTokensChanged({
      accessToken: "access-new",
      refreshToken: "refresh-new",
      expiresAt: 10_000,
    });
    expect(prisma.account.updateMany).toHaveBeenCalledWith({
      where: {
        id: "account-a",
        userId: "user-a",
        provider: "smartermail",
        disconnectedAt: null,
        updatedAt: new Date(1000),
      },
      data: {
        access_token: "access-new",
        refresh_token: "refresh-new",
        expires_at: new Date(10_000),
        updatedAt: expect.any(Date),
      },
    });
    const persistedRevision =
      prisma.account.updateMany.mock.calls[0][0].data.updatedAt;
    await options.onTokensChanged({
      accessToken: "access-next",
      refreshToken: "refresh-next",
    });
    expect(prisma.account.updateMany.mock.calls[1][0].where.updatedAt).toEqual(
      persistedRevision,
    );
    prisma.account.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      options.onTokensChanged({
        accessToken: "access-new",
        refreshToken: "refresh-new",
      }),
    ).rejects.toThrow("credentials changed");
  });
});
