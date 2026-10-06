import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { connectThunderbird } from "./connect";

const mocks = vi.hoisted(() => ({
  readAccount: vi.fn(),
  config: vi.fn(() => ({
    baseUrl: "http://localhost:8787",
    token: "test-token",
    ownerEmail: "owner@example.com",
  })),
}));
vi.mock("@/utils/prisma");
vi.mock("./config", () => ({ getThunderbirdConfig: mocks.config }));
vi.mock("./client", () => ({
  ThunderbirdClient: class {
    readAccount = mocks.readAccount;
  },
}));

describe("Thunderbird mailbox enrollment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({
      email: "OWNER@example.com",
    } as never);
    mocks.readAccount.mockResolvedValue({
      account: {
        id: "account1",
        email: "school@example.com",
        ready: true,
        inboxFound: true,
      },
    });
    prisma.emailAccount.findUnique.mockResolvedValue(null);
    prisma.account.upsert.mockResolvedValue({
      emailAccount: {
        id: "mailbox",
        userId: "owner",
        email: "school@example.com",
      },
    } as never);
  });
  it("prevents another signed-in user from claiming the configured bridge", async () => {
    prisma.user.findUnique.mockResolvedValue({
      email: "other@example.com",
    } as never);
    await expect(connectThunderbird("other")).rejects.toThrow("not configured");
    expect(mocks.readAccount).not.toHaveBeenCalled();
    expect(prisma.account.upsert).not.toHaveBeenCalled();
  });
  it("uses verified native mailbox identity independently of the owner's login email", async () => {
    await expect(connectThunderbird("owner")).resolves.toEqual({
      emailAccountId: "mailbox",
    });
    expect(prisma.account.upsert.mock.calls[0][0]).toMatchObject({
      where: {
        userId: "owner",
        emailAccount: { is: { email: "school@example.com", userId: "owner" } },
      },
      create: {
        thunderbirdAccountId: "account1",
        provider: "thunderbird",
        emailAccount: {
          create: { email: "school@example.com", userId: "owner" },
        },
      },
    });
  });
  it.each([
    {
      userId: "other",
      account: { provider: "thunderbird", thunderbirdAccountId: "account1" },
    },
    { userId: "owner", account: { provider: "microsoft" } },
    {
      userId: "owner",
      account: { provider: "thunderbird", thunderbirdAccountId: "different" },
    },
  ])("rejects preexisting conflicting mailbox ownership or provider", async (existing) => {
    prisma.emailAccount.findUnique.mockResolvedValue(existing as never);
    await expect(connectThunderbird("owner")).rejects.toThrow(
      "already connected",
    );
    expect(prisma.account.upsert).not.toHaveBeenCalled();
  });
  it("does not create an account when native mailbox readiness fails", async () => {
    mocks.readAccount.mockResolvedValue({
      account: {
        id: "account1",
        email: "school@example.com",
        ready: false,
        inboxFound: true,
      },
    });
    await expect(connectThunderbird("owner")).rejects.toThrow("ready mailbox");
    expect(prisma.account.upsert).not.toHaveBeenCalled();
  });
  it("sanitizes broker failures containing private details", async () => {
    mocks.readAccount.mockRejectedValue(new Error("private token secret"));
    await expect(connectThunderbird("owner")).rejects.toThrow(
      "bridge is unavailable",
    );
    expect(prisma.account.upsert).not.toHaveBeenCalled();
  });
});
