import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ThunderbirdBridgeError } from "@/utils/thunderbird/errors";
import {
  thunderbirdCommandSchema,
  type ThunderbirdOperation,
} from "@/utils/thunderbird/types";

const writes = new Set<ThunderbirdOperation>([
  "moveMessage",
  "updateMessage",
  "createFolder",
  "createDraft",
]);
export class ThunderbirdClient {
  readonly accountId?: string;
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly expectedEmail?: string;
  constructor({
    baseUrl,
    token,
    accountId,
    expectedEmail,
  }: {
    baseUrl: string;
    token: string;
    accountId?: string;
    expectedEmail?: string;
  }) {
    const url = new URL(baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "/" && url.pathname !== "")
    )
      throw new Error("Invalid Thunderbird bridge URL");
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(token))
      throw new Error("Invalid Thunderbird bridge credential");
    this.baseUrl = url.origin;
    this.token = token;
    this.accountId = accountId;
    this.expectedEmail = expectedEmail;
  }
  async readAccount() {
    const result = z
      .object({
        accountId: z.string().min(1),
        account: z.object({
          id: z.string().min(1),
          email: z.email(),
          ready: z.boolean(),
          inboxFound: z.boolean(),
        }),
      })
      .parse(await this.request("readAccount"));
    if (result.accountId !== result.account.id)
      throw new Error("Thunderbird bridge account identity mismatch");
    if (this.accountId && result.account.id !== this.accountId)
      throw new Error("Thunderbird bridge account scope mismatch");
    if (
      this.expectedEmail &&
      result.account.email.toLowerCase() !== this.expectedEmail.toLowerCase()
    )
      throw new Error("Thunderbird bridge mailbox scope mismatch");
    return result;
  }
  async request(
    operation: ThunderbirdOperation,
    body: Record<string, unknown> = {},
  ): Promise<unknown> {
    if (!this.accountId && operation !== "readAccount")
      throw new Error("Thunderbird mailbox is not bound");
    const mutation = writes.has(operation);
    const command = thunderbirdCommandSchema.parse({
      ...body,
      type: operation,
      ...(mutation ? { operationId: body.operationId ?? randomUUID() } : {}),
    });
    const encoded = JSON.stringify(command);
    if (Buffer.byteLength(encoded) > 1_048_576)
      throw new Error("Thunderbird request exceeds its size limit");
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/operator/commands`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: encoded,
        signal: AbortSignal.timeout(35_000),
        redirect: "manual",
        cache: "no-store",
      });
    } catch {
      throw new ThunderbirdBridgeError(
        mutation ? "WRITE_UNKNOWN" : "READ_FAILED",
        mutation
          ? "Thunderbird write outcome is unknown; inspect the mailbox before retrying"
          : "Thunderbird bridge could not be reached",
      );
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("Invalid Thunderbird bridge response");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 1_048_576)
          throw new Error("Thunderbird response exceeds its size limit");
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new Error("Invalid Thunderbird bridge JSON");
    }
    if (!response.ok) {
      const error = z
        .object({
          error: z.enum([
            "ACCOUNT_NOT_FOUND",
            "MESSAGE_NOT_FOUND",
            "OUT_OF_SCOPE",
            "READ_FAILED",
            "UNSUPPORTED",
            "TOO_LARGE",
            "STALE_PAGE",
            "WRITE_UNKNOWN",
            "LEDGER_FULL",
            "TIMEOUT",
            "REQUEST_REJECTED",
          ]),
        })
        .safeParse(payload);
      throw new ThunderbirdBridgeError(
        error.success ? error.data.error : "READ_FAILED",
        mutation
          ? "Thunderbird write failed or has an unknown outcome; do not retry automatically"
          : `Thunderbird bridge read failed (${response.status})`,
      );
    }
    const result = z
      .object({
        result: z.object({ accountId: z.string().min(1) }).passthrough(),
      })
      .parse(payload).result;
    if (this.accountId && result.accountId !== this.accountId)
      throw new Error("Thunderbird bridge account scope mismatch");
    return result;
  }
}
