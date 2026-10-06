import { z } from "zod";
import type { EmailLabel } from "@/utils/email/types";
import type {
  OutlookFolder,
  OutlookSystemFolder,
} from "@/utils/outlook/folders";
import { inboxZeroLabels, type InboxZeroLabel } from "@/utils/label";
import { thunderbirdFolderSchema } from "@/utils/thunderbird/types";
import { ThunderbirdUnsupportedProvider } from "@/utils/thunderbird/provider/unsupported";
import { ThunderbirdUnsupportedError } from "@/utils/thunderbird/errors";
const roles: Record<string, OutlookSystemFolder> = {
  inbox: "INBOX",
  sent: "SENT",
  drafts: "DRAFT",
  archives: "ARCHIVE",
  trash: "TRASH",
  junk: "SPAM",
};
export class ThunderbirdFoldersProvider extends ThunderbirdUnsupportedProvider {
  protected async nativeFolders() {
    return z
      .object({ folders: z.array(thunderbirdFolderSchema).max(500) })
      .parse(await this.client.request("listFolders"))
      .folders.filter((folder) => !folder.isRoot);
  }
  async getFolders(): Promise<OutlookFolder[]> {
    return (await this.nativeFolders()).map((folder) => ({
      id: folder.id,
      displayName: folder.path.replace(/^\//, "") || folder.name,
      childFolders: [],
      systemType: folder.specialUse.map((role) => roles[role]).find(Boolean),
      totalItemCount: folder.total,
      unreadItemCount: folder.unread,
    }));
  }
  protected async systemFolder(role: string) {
    const folder = (await this.getFolders()).find(
      (folder) => folder.systemType === role,
    );
    if (!folder)
      throw new ThunderbirdUnsupportedError(`missing ${role} folder`);
    return folder.id;
  }
  async getFolderCounts() {
    return (await this.getFolders()).map((folder) => {
      if (
        folder.totalItemCount === undefined ||
        folder.unreadItemCount === undefined
      )
        throw new ThunderbirdUnsupportedError("unreported folder counts");
      return {
        id: folder.id,
        name: folder.displayName,
        total: folder.totalItemCount,
        unread: folder.unreadItemCount,
        systemType: folder.systemType,
      };
    });
  }
  async getInboxStats() {
    const folder = (await this.getFolderCounts()).find(
      (folder) => folder.systemType === "INBOX",
    );
    if (!folder) throw new Error("Thunderbird Inbox unavailable");
    return { total: folder.total, unread: folder.unread };
  }
  async getLabels(): Promise<EmailLabel[]> {
    return (await this.getFolders()).map((folder) => ({
      id: folder.id,
      name: folder.displayName,
      type: folder.systemType ? "system" : "user",
      threadsTotal: folder.totalItemCount,
      threadsUnread: folder.unreadItemCount,
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
  async getOrCreateFolderIdByName(name: string) {
    const segments = name.split("/");
    if (
      !segments.length ||
      segments.some(
        (segment) =>
          !segment ||
          segment.length > 128 ||
          Array.from(segment).some(
            (char) =>
              char === "\\" ||
              char.charCodeAt(0) < 32 ||
              char.charCodeAt(0) === 127,
          ),
      )
    )
      throw new Error("Invalid Thunderbird folder path");
    const folders = await this.nativeFolders();
    let parentFolderId: string | undefined;
    let path = "";
    for (const segment of segments) {
      path = path ? `${path}/${segment}` : segment;
      const existing = folders.find(
        (folder) => folder.path.replace(/^\//, "") === path,
      );
      if (existing) {
        parentFolderId = existing.id;
        continue;
      }
      const result = z.object({ folder: thunderbirdFolderSchema }).parse(
        await this.client.request("createFolder", {
          name: segment,
          ...(parentFolderId ? { parentFolderId } : {}),
        }),
      );
      if (
        result.folder.isRoot ||
        result.folder.name !== segment ||
        result.folder.path.replace(/^\//, "") !== path
      )
        throw new Error(
          "Thunderbird created an unexpected folder; inspect before retrying",
        );
      parentFolderId = result.folder.id;
      folders.push(result.folder);
    }
    return parentFolderId!;
  }
  async createLabel(name: string) {
    const id = await this.getOrCreateFolderIdByName(name);
    const label = await this.getLabelById(id);
    if (!label) throw new Error("Thunderbird created folder could not be read");
    return label;
  }
  async getOrCreateInboxZeroLabel(key: InboxZeroLabel) {
    return this.createLabel(inboxZeroLabels[key].name);
  }
}
