import { categoryName } from "@/utils/smartermail/provider/helpers";
import type { EmailProvider } from "@/utils/email/types";

import { SmarterMailContactsProvider } from "@/utils/smartermail/provider/contacts";

export class SmarterMailMutationsProvider extends SmarterMailContactsProvider {
  async removeThreadLabels(threadId: string, labelIds: string[]) {
    const names = labelIds.map(categoryName);
    await this.groupMutation(
      (await this.getThreadMessages(threadId)).map((message) => message.id),
      async (folder, uid) => {
        await this.client.request("patchMessageCategories", {
          folder,
          uid,
          categories: names,
          removeCategories: true,
          clearCategories: false,
        });
      },
    );
  }
  async markMessagesReadState(ids: string[], read: boolean) {
    await this.patch(ids, { markRead: read });
  }
  async markMessagesStarredState(ids: string[], starred: boolean) {
    await this.patch(ids, { markFlagged: starred });
  }
  async markRead(id: string) {
    await this.markReadThread(id, true);
  }
  async markReadThread(id: string, read: boolean) {
    await this.markMessagesReadState(
      (await this.getThreadMessages(id)).map((message) => message.id),
      read,
    );
  }
  async starMessage(id: string) {
    await this.markMessagesStarredState([id], true);
  }
  async archiveMessage(id: string) {
    await this.archiveMessages([id]);
  }
  async archiveMessages(ids: string[], labelId?: string) {
    if (labelId)
      for (const id of ids)
        await this.labelMessage({ messageId: id, labelId, labelName: null });
    await this.move(ids, await this.getOrCreateFolderIdByName("Archive"));
  }
  async archiveThread(id: string, _owner: string) {
    await this.archiveMessages(
      (await this.getThreadMessages(id)).map((message) => message.id),
    );
  }
  async archiveThreadWithLabel(id: string, _owner: string, labelId?: string) {
    await this.archiveMessages(
      (await this.getThreadMessages(id)).map((message) => message.id),
      labelId,
    );
  }
  async bulkArchiveThreads(
    threads: Parameters<EmailProvider["bulkArchiveThreads"]>[0],
  ) {
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
  async moveThreadToFolder(id: string, _owner: string, name: string) {
    await this.move(
      (await this.getThreadMessages(id)).map((message) => message.id),
      await this.getOrCreateFolderIdByName(name),
    );
  }
  async trashMessages(ids: string[]) {
    await this.groupMutation(ids, async (folder, uid) => {
      await this.client.request("deleteMessages", {
        folder,
        uID: uid,
        all: false,
        moveToDeleted: true,
      });
    });
  }
  async trashThread(id: string) {
    await this.trashMessages(
      (await this.getThreadMessages(id)).map((message) => message.id),
    );
  }
  async unarchiveMessages(ids: string[]) {
    await this.move(ids, await this.systemFolder("INBOX"));
  }
  async unarchiveThread(id: string) {
    await this.unarchiveMessages([id]);
  }
  async untrashMessages(ids: string[]) {
    await this.unarchiveMessages(ids);
  }
  async untrashThread(id: string) {
    await this.unarchiveMessages([id]);
  }
  async markSpam(id: string) {
    await this.patch(
      (await this.getThreadMessages(id)).map((message) => message.id),
      { markSpam: true },
    );
  }
  async markNotSpam(id: string) {
    await this.patch(
      (await this.getThreadMessages(id)).map((message) => message.id),
      { markNotSpam: true },
    );
  }
}
