import "server-only";
import { SmarterMailApiError, SmarterMailMfaRequiredError } from "./errors";
import { SmarterMailTransport } from "./transport";
import type { SmarterMailTokens } from "./tokens";
import { SmarterMailSession } from "./session";

export class SmarterMailAuthentication extends SmarterMailSession {
  protected readonly transport: SmarterMailTransport;
  protected refreshPromise?: Promise<void>;

  constructor({
    baseUrl,
    tokens,
    timeoutMs,
    onTokensChanged,
  }: {
    baseUrl: string;
    tokens?: SmarterMailTokens;
    timeoutMs?: number;
    onTokensChanged?: (tokens: SmarterMailTokens) => void | Promise<void>;
  }) {
    super({ tokens, onTokensChanged });
    this.transport = new SmarterMailTransport(baseUrl, timeoutMs);
  }

  async authenticate(credentials: { username: string; password: string }) {
    this.beginAuthentication();
    try {
      this.tokens = undefined;
      this.mfaToken = undefined;
      const payload = await this.transport.request(
        "auth/authenticate-user",
        "POST",
        { ...credentials, clientId: "inbox-zero" },
      );
      if (
        payload !== null &&
        typeof payload === "object" &&
        "message" in payload &&
        typeof payload.message === "string" &&
        payload.message.startsWith("TWO_FACTOR_REQUIRED")
      ) {
        if (
          !("accessToken" in payload) ||
          typeof payload.accessToken !== "string" ||
          !payload.accessToken
        )
          throw new SmarterMailApiError("Invalid SmarterMail MFA response");
        this.mfaToken = payload.accessToken;
        throw new SmarterMailMfaRequiredError();
      }
      await this.saveTokens(payload);
    } finally {
      this.endAuthentication();
    }
  }

  async completeMfa(twoFactorCode: string) {
    this.beginAuthentication();
    try {
      const challengeToken = this.mfaToken;
      this.mfaToken = undefined;
      if (!challengeToken)
        throw new SmarterMailApiError("No pending SmarterMail MFA challenge");
      const payload = await this.transport.request(
        "auth/authenticate-two-factor-code",
        "POST",
        { twoFactorCode, clientId: "inbox-zero" },
        challengeToken,
      );
      await this.saveTokens(payload);
    } finally {
      this.endAuthentication();
    }
  }

  protected async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    const refreshToken = this.tokens?.refreshToken;
    if (!refreshToken)
      throw new SmarterMailApiError("SmarterMail account must be reconnected");
    this.refreshPromise = this.transport
      .request("auth/refresh-token", "POST", { token: refreshToken })
      .then((payload) => this.saveTokens(payload));
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }
}
