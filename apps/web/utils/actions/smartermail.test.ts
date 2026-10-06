import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { connectSmarterMailAction } from "@/utils/actions/smartermail";
import { SmarterMailMfaRequiredError } from "@/utils/smartermail/errors";

const state = vi.hoisted(() => ({
  mfa: false,
  signedIn: true,
  authenticate: vi.fn(),
  clearDisconnected: vi.fn(),
  watch: vi.fn(),
}));
vi.mock("@/utils/error-messages", () => ({
  clearAccountDisconnectedErrorIfResolved: state.clearDisconnected,
}));
vi.mock("@/utils/smartermail/watch", () => ({
  watchSmarterMailEmails: state.watch,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/utils/prisma");
vi.mock("@/env", () => ({
  env: {
    SMARTERMAIL_ALLOWED_ORIGINS: "https://mail.example.com",
    EMAIL_ENCRYPT_SECRET: "configured",
    EMAIL_ENCRYPT_SALT: "configured",
  },
}));
vi.mock("@/utils/auth", () => ({
  auth: vi.fn(async () =>
    state.signedIn
      ? { user: { id: "user-a", email: "identity@example.com" } }
      : null,
  ),
}));
vi.mock("@sentry/nextjs", () => import("@/__tests__/mocks/sentry-nextjs.mock"));
vi.mock("@/utils/smartermail/client", () => ({
  SmarterMailClient: class {
    private readonly options: { onTokensChanged: (tokens: unknown) => void };
    constructor(options: { onTokensChanged: (tokens: unknown) => void }) {
      this.options = options;
    }
    async authenticate() {
      state.authenticate();
      if (state.mfa) throw new SmarterMailMfaRequiredError();
      this.options.onTokensChanged({
        accessToken: "access",
        refreshToken: "refresh",
      });
    }
    async completeMfa(code: string) {
      if (code !== "123456") throw new Error("invalid code");
      this.options.onTokensChanged({
        accessToken: "access",
        refreshToken: "refresh",
      });
    }
  },
}));

const credentials = {
  baseUrl: "https://mail.example.com",
  username: "mailbox@example.com",
  password: "private-password",
};

describe("SmarterMail connection action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.mfa = false;
    state.signedIn = true;
    prisma.emailAccount.findUnique.mockResolvedValue(null);
    prisma.account.upsert.mockResolvedValue({
      emailAccount: { id: "mailbox-a" },
    } as never);
  });
  it("requires application authentication before contacting the mail server", async () => {
    state.signedIn = false;
    expect((await connectSmarterMailAction(credentials))?.serverError).toBe(
      "Unauthorized",
    );
    expect(state.authenticate).not.toHaveBeenCalled();
  });
  it.each([
    { userId: "user-b", provider: "smartermail", baseUrl: credentials.baseUrl },
    { userId: "user-a", provider: "google", baseUrl: credentials.baseUrl },
    { userId: "user-a", provider: "microsoft", baseUrl: credentials.baseUrl },
    {
      userId: "user-a",
      provider: "smartermail",
      baseUrl: "https://other.example.com",
    },
  ])("rejects a mailbox owned by another user, provider, or server: $provider $userId $baseUrl", async ({
    userId,
    provider,
    baseUrl,
  }) => {
    prisma.emailAccount.findUnique.mockResolvedValue({
      userId,
      account: {
        provider,
        smarterMailBaseUrl: baseUrl,
      },
    } as never);
    expect(
      (await connectSmarterMailAction(credentials))?.serverError,
    ).toContain("already connected");
    expect(state.authenticate).not.toHaveBeenCalled();
  });
  it("does not save credentials until MFA succeeds", async () => {
    state.mfa = true;
    expect((await connectSmarterMailAction(credentials))?.data).toEqual({
      mfaRequired: true,
    });
    expect(prisma.account.upsert).not.toHaveBeenCalled();
    expect(state.clearDisconnected).not.toHaveBeenCalled();
    expect(state.watch).not.toHaveBeenCalled();
    expect(
      (await connectSmarterMailAction({ ...credentials, twoFactorCode: "bad" }))
        ?.serverError,
    ).toContain("authentication code");
    expect(prisma.account.upsert).not.toHaveBeenCalled();
    expect(
      (
        await connectSmarterMailAction({
          ...credentials,
          twoFactorCode: "123456",
        })
      )?.data,
    ).toEqual({ mfaRequired: false, emailAccountId: "mailbox-a" });
    const saved = prisma.account.upsert.mock.calls[0][0];
    expect(saved.create).not.toHaveProperty("password");
    expect(saved.create).toMatchObject({
      userId: "user-a",
      access_token: "access",
      refresh_token: "refresh",
    });
    expect(saved.where).toMatchObject({ userId: "user-a" });
    expect(state.clearDisconnected).toHaveBeenCalledWith({
      userId: "user-a",
      logger: expect.any(Object),
    });
    expect(state.watch).toHaveBeenCalledWith("mailbox-a");
  });
});
