import { SmarterMailApiError } from "./errors";
import {
  authenticationSchema,
  assertSmarterMailSuccess,
  getTokenExpiry,
  type SmarterMailTokens,
} from "./tokens";

export class SmarterMailSession {
  #tokens?: SmarterMailTokens;
  #mfaToken?: string;
  #authenticationPending = false;
  #activeRequests = 0;
  #identityVersion = 0;
  readonly #onTokensChanged?: (
    tokens: SmarterMailTokens,
  ) => void | Promise<void>;

  constructor({
    tokens,
    onTokensChanged,
  }: {
    tokens?: SmarterMailTokens;
    onTokensChanged?: (tokens: SmarterMailTokens) => void | Promise<void>;
  }) {
    this.#tokens = tokens ? { ...tokens } : undefined;
    this.#onTokensChanged = onTokensChanged;
  }

  protected get tokens() {
    return this.#tokens;
  }
  protected set tokens(value: SmarterMailTokens | undefined) {
    this.#tokens = value;
  }
  protected get mfaToken() {
    return this.#mfaToken;
  }
  protected set mfaToken(value: string | undefined) {
    this.#mfaToken = value;
  }

  protected beginAuthentication() {
    if (this.#authenticationPending || this.#activeRequests) {
      throw new SmarterMailApiError(
        "SmarterMail client is busy. Retry authentication after active requests finish.",
      );
    }
    this.#authenticationPending = true;
    this.#identityVersion += 1;
  }

  protected endAuthentication() {
    this.#authenticationPending = false;
  }

  protected beginRequest() {
    if (this.#authenticationPending)
      throw new SmarterMailApiError(
        "SmarterMail authentication is in progress.",
      );
    this.#activeRequests += 1;
    return this.#identityVersion;
  }

  protected endRequest() {
    this.#activeRequests -= 1;
  }

  protected assertIdentity(version: number) {
    if (version !== this.#identityVersion)
      throw new SmarterMailApiError(
        "SmarterMail account identity changed. Retry the request.",
      );
  }

  toJSON() {
    return { type: "SmarterMailClient" };
  }

  protected async saveTokens(payload: unknown) {
    assertSmarterMailSuccess(payload);
    const parsed = authenticationSchema.safeParse(payload);
    if (!parsed.success)
      throw new SmarterMailApiError(
        "Invalid SmarterMail authentication response",
      );
    const tokens: SmarterMailTokens = {
      ...parsed.data,
      expiresAt: getTokenExpiry(parsed.data.accessToken),
    };
    try {
      await this.#onTokensChanged?.({ ...tokens });
    } catch {
      throw new SmarterMailApiError(
        "SmarterMail credentials could not be saved. Retry the request.",
      );
    }
    this.#tokens = tokens;
  }
}
