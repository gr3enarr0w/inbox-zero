import { parseSmarterMailMessageId } from "@/utils/smartermail/message";
import type { EmailProvider } from "@/utils/email/types";
import type { SmarterMailClient } from "@/utils/smartermail/client";
import type { Logger } from "@/utils/logger";
import { SmarterMailUnsupportedError } from "@/utils/smartermail/provider/error";

export abstract class SmarterMailProviderContext {
  readonly name = "smartermail" as const;
  readonly localMailSyncStrategy = "folder-delta" as const;
  protected readonly client: SmarterMailClient;
  protected readonly logger: Logger;
  protected readonly emailAccountId: string;
  constructor(
    client: SmarterMailClient,
    logger: Logger,
    emailAccountId: string,
  ) {
    this.client = client;
    this.logger = logger;
    this.emailAccountId = emailAccountId;
  }
  abstract getFolders(): ReturnType<EmailProvider["getFolders"]>;
  toJSON() {
    return { name: this.name, type: "SmarterMailProvider" };
  }
  getAccessToken(): string {
    throw new SmarterMailUnsupportedError("direct token access");
  }
  isSentMessage(
    _message: Parameters<EmailProvider["isSentMessage"]>[0],
  ): boolean {
    throw new SmarterMailUnsupportedError("isSentMessage");
  }
  isReplyInThread(
    _message: Parameters<EmailProvider["isReplyInThread"]>[0],
  ): boolean {
    throw new SmarterMailUnsupportedError("isReplyInThread");
  }
  protected async systemFolder(role: string) {
    const folder = (await this.getFolders()).find(
      (folder) => folder.systemType === role,
    );
    if (!folder) throw new Error(`SmarterMail ${role} folder unavailable`);
    return folder.id;
  }
  protected async patch(ids: string[], flags: Record<string, boolean>) {
    await this.groupMutation(ids, async (folder, uid) => {
      await this.client.request("patchMessages", { folder, uid, ...flags });
    });
  }
  protected async move(ids: string[], destinationFolder: string) {
    await this.groupMutation(ids, async (folder, uid) => {
      await this.client.request("moveMessages", {
        folder,
        uID: uid,
        destinationFolder,
      });
    });
  }
  protected async groupMutation(
    ids: string[],
    operation: (folder: string, uid: number[]) => Promise<void>,
  ) {
    const groups = new Map<string, number[]>();
    for (const id of ids) {
      const reference = parseSmarterMailMessageId(id);
      const group = groups.get(reference.folder) ?? [];
      group.push(reference.uid);
      groups.set(reference.folder, group);
    }
    for (const [folder, uids] of groups)
      await operation(folder, [...new Set(uids)]);
  }
}
