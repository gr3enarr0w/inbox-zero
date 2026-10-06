import { SmarterMailUnsupportedError } from "@/utils/smartermail/provider/error";
import { z } from "zod";
import type { EmailProvider, EmailLabel } from "@/utils/email/types";
import { inboxZeroLabels } from "@/utils/label";
import { smarterMailCategoryId } from "@/utils/smartermail/message";

import { SmarterMailFoldersProvider } from "@/utils/smartermail/provider/folders";
import { categorySettingsSchema } from "@/utils/smartermail/provider/schemas";
import { categoryName } from "@/utils/smartermail/provider/helpers";

export class SmarterMailCategoriesProvider extends SmarterMailFoldersProvider {
  async getLabels(): Promise<EmailLabel[]> {
    const settings = z
      .object({ categorySettings: categorySettingsSchema })
      .parse(await this.client.request("categorySettings")).categorySettings;
    return settings.categories.map((category) => ({
      id: smarterMailCategoryId(category.name),
      name: category.name,
      type: "user",
    }));
  }
  async getLabelById(id: string) {
    return (await this.getLabels()).find((label) => label.id === id) ?? null;
  }
  async getLabelByName(name: string) {
    return (
      (await this.getLabels()).find((label) => label.name === name) ?? null
    );
  }
  async createLabel(name: string): Promise<EmailLabel> {
    const existing = await this.getLabelByName(name);
    if (existing) return existing;
    throw new SmarterMailUnsupportedError(
      "creating categories safely; create the category in SmarterMail first",
    );
  }
  async getOrCreateInboxZeroLabel(
    key: Parameters<EmailProvider["getOrCreateInboxZeroLabel"]>[0],
  ) {
    return this.createLabel(inboxZeroLabels[key].name);
  }
  async labelMessage(options: Parameters<EmailProvider["labelMessage"]>[0]) {
    const name = categoryName(options.labelId);
    if (options.labelName && options.labelName !== name)
      throw new Error("SmarterMail category reference does not match its name");
    await this.groupMutation([options.messageId], async (folder, uid) => {
      await this.client.request("patchMessageCategories", {
        folder,
        uid,
        categories: [name],
        removeCategories: false,
        clearCategories: false,
      });
    });
    return { actualLabelId: options.labelId };
  }
  async removeThreadLabel(threadId: string, labelId: string) {
    await this.removeThreadLabels(threadId, [labelId]);
  }
  async removeThreadLabels(threadId: string, labelIds: string[]) {
    await this.groupMutation([threadId], async (folder, uid) => {
      await this.client.request("patchMessageCategories", {
        folder,
        uid,
        categories: labelIds.map(categoryName),
        removeCategories: true,
        clearCategories: false,
      });
    });
  }
}
