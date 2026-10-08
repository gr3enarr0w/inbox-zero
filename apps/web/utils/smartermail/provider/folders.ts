import { z } from "zod";
import type {
  OutlookFolder,
  OutlookSystemFolder,
} from "@/utils/outlook/folders";
import { smarterMailFolderRole } from "@/utils/smartermail/message";

import { SmarterMailProviderBase } from "@/utils/smartermail/provider/base";
import { folderSchema } from "@/utils/smartermail/provider/schemas";

export class SmarterMailFoldersProvider extends SmarterMailProviderBase {
  private async ownedFolders() {
    const payload = z
      .object({ folderList: z.array(folderSchema) })
      .parse(await this.client.request("folders"));
    return flattenFolders(payload.folderList);
  }
  async getFolders(): Promise<OutlookFolder[]> {
    return (await this.ownedFolders()).map((folder) => {
      const path = folder.path ?? folder.folder ?? folder.name;
      if (!path) throw new Error("SmarterMail folder has no path");
      return {
        id: path,
        displayName: path,
        childFolders: [],
        totalItemCount: folder.totalMessages,
        unreadItemCount: folder.unread,
        systemType: smarterMailFolderRole(path) as
          | OutlookSystemFolder
          | undefined,
      };
    });
  }
  async getStatsFolders() {
    return (await this.ownedFolders()).map((folder) => {
      const metadata = z
        .object({
          guid: z.string().min(1).optional(),
          changeNumber: z.number().int().nonnegative().optional(),
          totalMessages: z.number().int().nonnegative().optional(),
        })
        .parse(folder);
      const id = folder.path ?? folder.folder ?? folder.name;
      if (!id) throw new Error("SmarterMail folder has no path");
      return {
        id,
        guid: metadata.guid,
        changeNumber: metadata.changeNumber,
        total: metadata.totalMessages,
      };
    });
  }
  async getFolderCounts() {
    return (await this.getFolders()).map((folder) => ({
      id: folder.id,
      name: folder.displayName,
      total: folder.totalItemCount ?? 0,
      unread: folder.unreadItemCount ?? 0,
      systemType: folder.systemType,
    }));
  }
  async getInboxStats() {
    const folder = (await this.getFolderCounts()).find(
      (folder) => folder.systemType === "INBOX",
    );
    if (!folder) throw new Error("SmarterMail inbox folder unavailable");
    return { total: folder.total, unread: folder.unread };
  }
  async getOrCreateFolderIdByName(folderName: string) {
    const existing = (await this.getFolders()).find(
      (folder) => folder.id === folderName,
    );
    if (existing) return existing.id;
    await this.client.request("addFolder", { folder: folderName });
    return folderName;
  }
  async renameFolder(folderId: string, name: string) {
    await this.client.request("editFolder", {
      folder: folderId,
      newFolder: name,
    });
  }
  async deleteFolder(folderId: string) {
    if (smarterMailFolderRole(folderId))
      throw new Error("Cannot delete a system mail folder");
    await this.client.request("deleteFolder", { folder: folderId });
  }
}

function flattenFolders(rows: unknown[]): Array<z.infer<typeof folderSchema>> {
  return rows.flatMap((row) => {
    const folder = folderSchema.parse(row);
    if (folder.isMappedFolder || folder.isMappedSubfolder) return [];
    return [
      folder,
      ...flattenFolders(
        Array.isArray(folder.subFolders) ? folder.subFolders : [],
      ),
    ];
  });
}
