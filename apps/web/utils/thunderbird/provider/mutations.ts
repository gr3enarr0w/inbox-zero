import { z } from "zod";
import type { EmailProvider } from "@/utils/email/types";
import { ThunderbirdThreadsProvider } from "@/utils/thunderbird/provider/threads";
import {
  thunderbirdIdentitySchema,
  thunderbirdMessageSchema,
} from "@/utils/thunderbird/types";
import { assertThunderbirdIdentity } from "@/utils/thunderbird/message";
export class ThunderbirdMutationsProvider extends ThunderbirdThreadsProvider {
  protected async moveMessage(id: string, folderId: string) {
    if (!(await this.getFolders()).some((folder) => folder.id === folderId))
      throw new Error("Thunderbird destination folder scope mismatch");
    const message = await this.nativeMessage(id);
    if (message.folderId === folderId) return;
    const identity = thunderbirdIdentitySchema.parse(message);
    const result = z.object({ message: thunderbirdMessageSchema }).parse(
      await this.client.request("moveMessage", {
        messageId: message.id,
        identity,
        destinationFolderId: folderId,
      }),
    );
    assertThunderbirdIdentity(result.message, identity);
    if (result.message.folderId !== folderId)
      throw new Error(
        "Thunderbird move outcome could not be confirmed; inspect before retrying",
      );
  }
  protected async updateMessage(
    id: string,
    changes: { read?: boolean; flagged?: boolean },
  ) {
    const message = await this.nativeMessage(id);
    const identity = thunderbirdIdentitySchema.parse(message);
    const result = z.object({ message: thunderbirdMessageSchema }).parse(
      await this.client.request("updateMessage", {
        messageId: message.id,
        identity,
        ...changes,
      }),
    );
    assertThunderbirdIdentity(result.message, identity);
    if (
      (changes.read !== undefined && result.message.read !== changes.read) ||
      (changes.flagged !== undefined &&
        result.message.flagged !== changes.flagged)
    )
      throw new Error(
        "Thunderbird update outcome could not be confirmed; inspect before retrying",
      );
  }
  async labelMessage(options: Parameters<EmailProvider["labelMessage"]>[0]) {
    await this.moveMessage(options.messageId, options.labelId);
    return { actualLabelId: options.labelId };
  }
  async archiveMessage(id: string) {
    const message = await this.nativeMessage(id);
    if (message.folderId !== (await this.systemFolder("INBOX"))) return;
    await this.moveMessage(id, await this.systemFolder("ARCHIVE"));
  }
  async archiveMessages(ids: string[], labelId?: string) {
    for (const id of boundedIds(ids)) {
      if (labelId) await this.moveMessage(id, labelId);
      else await this.archiveMessage(id);
    }
  }
  async archiveThread(id: string, _ownerEmail: string) {
    await this.archiveMessage(id);
  }
  async archiveThreadWithLabel(
    id: string,
    _ownerEmail: string,
    labelId?: string,
  ) {
    await this.archiveMessages([id], labelId);
  }
  async bulkArchiveThreads(
    threads: Parameters<EmailProvider["bulkArchiveThreads"]>[0],
  ) {
    if (threads.length > 25)
      throw new Error("Thunderbird mutation batch exceeds 25");
    const succeededThreadIds: string[] = [];
    const failedThreadIds: string[] = [];
    for (const thread of threads) {
      try {
        await this.archiveMessages(thread.messageIds);
        succeededThreadIds.push(thread.threadId);
      } catch {
        failedThreadIds.push(thread.threadId);
      }
    }
    return { succeededThreadIds, failedThreadIds };
  }
  async moveThreadToFolder(id: string, _ownerEmail: string, name: string) {
    await this.moveMessage(id, await this.getOrCreateFolderIdByName(name));
  }
  async markMessagesReadState(ids: string[], read: boolean) {
    for (const id of boundedIds(ids)) await this.updateMessage(id, { read });
  }
  async markMessagesStarredState(ids: string[], flagged: boolean) {
    for (const id of boundedIds(ids)) await this.updateMessage(id, { flagged });
  }
  async markRead(id: string) {
    await this.markMessagesReadState([id], true);
  }
  async markReadThread(id: string, read: boolean) {
    await this.markMessagesReadState([id], read);
  }
  async starMessage(id: string) {
    await this.markMessagesStarredState([id], true);
  }
  async markSpam(id: string) {
    await this.moveMessage(id, await this.systemFolder("SPAM"));
  }
  async markNotSpam(id: string) {
    await this.unarchiveThread(id);
  }
  async trashMessages(ids: string[]) {
    const folder = await this.systemFolder("TRASH");
    for (const id of boundedIds(ids)) await this.moveMessage(id, folder);
  }
  async trashThread(
    id: string,
    _ownerEmail: string,
    _actionSource: "user" | "automation",
  ) {
    await this.trashMessages([id]);
  }
  async unarchiveMessages(ids: string[]) {
    const folder = await this.systemFolder("INBOX");
    for (const id of boundedIds(ids)) await this.moveMessage(id, folder);
  }
  async unarchiveThread(id: string) {
    await this.unarchiveMessages([id]);
  }
  async untrashMessages(ids: string[]) {
    await this.unarchiveMessages(ids);
  }
  async untrashThread(id: string) {
    await this.unarchiveThread(id);
  }
  async removeThreadLabels(id: string, labelIds: string[]) {
    const message = await this.nativeMessage(id);
    if (labelIds.includes(message.folderId)) await this.unarchiveThread(id);
  }
  async removeThreadLabel(id: string, labelId: string) {
    await this.removeThreadLabels(id, [labelId]);
  }
}
function boundedIds(ids: string[]) {
  if (ids.length > 25) throw new Error("Thunderbird mutation batch exceeds 25");
  return ids;
}
