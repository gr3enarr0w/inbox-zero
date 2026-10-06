import type { Logger } from "@/utils/logger";
import type { ThunderbirdClient } from "@/utils/thunderbird/client";
import { ThunderbirdUnsupportedError } from "@/utils/thunderbird/errors";
export class ThunderbirdProviderContext {
  readonly name = "thunderbird" as const;
  readonly localMailSyncStrategy = "folder-delta" as const;
  protected readonly nativeAccountId: string;
  protected readonly client: ThunderbirdClient;
  protected readonly logger: Logger;
  protected readonly emailAccountId: string;
  constructor(
    client: ThunderbirdClient,
    logger: Logger,
    emailAccountId: string,
  ) {
    if (!client.accountId)
      throw new Error("Thunderbird provider requires a bound account");
    this.nativeAccountId = client.accountId;
    this.client = client;
    this.logger = logger;
    this.emailAccountId = emailAccountId;
  }
  toJSON() {
    return { name: this.name, type: "ThunderbirdProvider" };
  }
  getAccessToken(): string {
    throw new ThunderbirdUnsupportedError("direct credential access");
  }
}
