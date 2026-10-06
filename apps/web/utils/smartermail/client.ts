import "server-only";
import { SmarterMailAuthentication } from "./authentication";
import { SmarterMailApiError } from "./errors";
import { operations, type SmarterMailOperation } from "./operations";
import { assertSmarterMailSuccess } from "./tokens";

/** Account-scoped transport; callers validate endpoint-specific response bodies. */
export class SmarterMailClient extends SmarterMailAuthentication {
  async request(
    operation: SmarterMailOperation,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const identityVersion = this.beginRequest();
    try {
      return await this.requestForIdentity(operation, body, identityVersion);
    } finally {
      this.endRequest();
    }
  }

  private async requestForIdentity(
    operation: SmarterMailOperation,
    body: Record<string, unknown> | undefined,
    identityVersion: number,
  ): Promise<unknown> {
    if (!Object.hasOwn(operations, operation)) {
      throw new SmarterMailApiError("Unknown SmarterMail operation");
    }
    const spec = operations[operation];
    if (!this.tokens) {
      throw new SmarterMailApiError("SmarterMail account is not authenticated");
    }
    if (this.refreshPromise) await this.refreshPromise;
    if (
      this.tokens.expiresAt !== undefined &&
      this.tokens.expiresAt <= Date.now() + 30_000
    ) {
      await this.refresh();
    }
    const accessToken = this.tokens.accessToken;
    this.assertIdentity(identityVersion);
    let payload: unknown;
    try {
      payload = await this.transport.request(
        spec.path,
        spec.method,
        body,
        accessToken,
      );
    } catch (error) {
      if (
        !(error instanceof SmarterMailApiError) ||
        error.status !== 401 ||
        !spec.readOnly
      ) {
        throw error;
      }
      // A second concurrent read may already have rotated the expired token.
      if (this.tokens.accessToken === accessToken) await this.refresh();
      else if (this.refreshPromise) await this.refreshPromise;
      this.assertIdentity(identityVersion);
      payload = await this.transport.request(
        spec.path,
        spec.method,
        body,
        this.tokens.accessToken,
      );
    }
    assertSmarterMailSuccess(payload);
    this.assertIdentity(identityVersion);
    return payload;
  }
}
