import "server-only";
import { SmarterMailApiError } from "./errors";

export class SmarterMailTransport {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  // The account-linking boundary must also validate this origin against SSRF.
  constructor(baseUrl: string, timeoutMs = 30_000) {
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new SmarterMailApiError("Invalid SmarterMail server URL");
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new SmarterMailApiError(
        "SmarterMail requires a clean HTTPS server URL",
      );
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new SmarterMailApiError("Invalid SmarterMail request timeout");
    }
    this.baseUrl = `${url.href.replace(/\/+$/, "")}/api/v1/`;
    this.timeoutMs = timeoutMs;
  }

  async request(
    path: string,
    method: string,
    body?: Record<string, unknown>,
    accessToken?: string,
  ): Promise<unknown> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "manual",
        cache: "no-store",
        signal,
      });
    } catch {
      throw new SmarterMailApiError(
        signal.aborted
          ? "SmarterMail request timed out"
          : "SmarterMail server could not be reached",
      );
    }
    if (!response.ok) {
      // Raw server errors can contain mail content or credentials.
      throw new SmarterMailApiError(
        `SmarterMail request failed (${response.status})`,
        response.status,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new SmarterMailApiError(
        signal.aborted
          ? "SmarterMail request timed out"
          : "Invalid SmarterMail JSON response",
      );
    }
  }
}
