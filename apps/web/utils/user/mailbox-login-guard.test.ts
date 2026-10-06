import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { getMailboxDeletionLoginGuard } from "./mailbox-login-guard";

vi.mock("@/utils/prisma");
vi.mock("@/utils/oauth/login-providers", () => ({
  getEnabledLoginProviders: () => new Set(["google", "microsoft", "apple"]),
}));

describe("mailbox deletion login access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.account.count.mockResolvedValue(1);
  });
  it("rejects deleting the last sign-in identity when only SmarterMail remains", async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      getMailboxDeletionLoginGuard("user", "login-account"),
    ).rejects.toThrow("enable email code sign-in");
    expect(prisma.account.count.mock.calls[0][0]?.where).toMatchObject({
      provider: { in: ["smartermail", "thunderbird"] },
    });
    expect(prisma.user.findFirst.mock.calls[0][0]?.where).toMatchObject({
      id: "user",
      OR: [
        { emailOtpEnabled: true },
        {
          accounts: {
            some: {
              id: { not: "login-account" },
              provider: { in: ["google", "microsoft", "apple"] },
            },
          },
        },
      ],
    });
  });
  it("retains the sign-in guard for the final locked deletion when another login exists or OTP is enabled", async () => {
    prisma.user.findFirst.mockResolvedValue({ id: "user" } as never);
    const guard = await getMailboxDeletionLoginGuard("user", "login-account");
    expect(guard).toHaveProperty("user.OR");
    expect(guard.user?.OR[1]).toMatchObject({
      accounts: { some: { id: { not: "login-account" } } },
    });
  });
  it("does not restrict deleting a SmarterMail connection that cannot be used to sign in", async () => {
    prisma.account.count.mockResolvedValue(0);
    expect(await getMailboxDeletionLoginGuard("user", "mail-account")).toEqual(
      {},
    );
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });
});
