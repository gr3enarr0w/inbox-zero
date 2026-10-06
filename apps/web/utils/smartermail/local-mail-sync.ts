import { getSmarterMailLocalBackfill } from "@/utils/smartermail/local-mail-backfill";
import { parseSmarterMailMessageId } from "@/utils/smartermail/message";
import type { EmailProvider } from "@/utils/email/types";
import type { LocalMailSyncRequest } from "@/utils/actions/local-mail-sync.validation";
import type { LocalMailSyncResponse } from "@/utils/email/local-mail-sync-types";
import {
  smarterMailBodyMessage,
  smarterMailMetadataPatch,
} from "@/utils/smartermail/local-mail-metadata";
import { InvalidMailboxSyncCursorError } from "@/utils/email/mailbox-sync";

export async function syncSmarterMailLocalMail(
  provider: EmailProvider & {
    hasMessagesInFolder: (folderId: string, ids: string[]) => Promise<string[]>;
  },
  request: LocalMailSyncRequest,
  emailAccountId: string,
): Promise<LocalMailSyncResponse> {
  if (request.phase === "capabilities") {
    const folders = await provider.getFolders();
    return {
      status: "ok",
      phase: request.phase,
      result: {
        strategy: "folder-delta",
        maxHydrationMessages: 1,
        excludedFolderIds: folders
          .filter((folder) =>
            ["DRAFT", "TRASH", "SPAM"].includes(folder.systemType ?? ""),
          )
          .map((folder) => folder.id),
      },
    };
  }
  if (request.phase === "folders") {
    if (request.cursor)
      return { status: "reset-required", phase: request.phase };
    return {
      status: "ok",
      phase: request.phase,
      result: {
        folders: (await provider.getFolders())
          .filter(
            (folder) =>
              !request.parentFolderId ||
              folder.id.slice(0, folder.id.lastIndexOf("/")) ===
                request.parentFolderId,
          )
          .map((folder) => ({
            ...folder,
            parentFolderId: folder.id.includes("/")
              ? folder.id.slice(0, folder.id.lastIndexOf("/"))
              : undefined,
            isHidden: undefined,
            totalItemCount: folder.totalItemCount,
            unreadItemCount: folder.unreadItemCount,
            childFolderCount: folder.childFolders?.length ?? 0,
          })),
        nextCursor: undefined,
      },
    };
  }
  if (request.phase === "message-lookup") {
    const { folder } = parseSmarterMailMessageId(request.messageId);
    if (
      !(await provider.hasMessagesInFolder(folder, [request.messageId])).length
    )
      return {
        status: "ok",
        phase: request.phase,
        result: { status: "notFound" },
      };
    const message = await provider.getMessage(request.messageId);
    return {
      status: "ok",
      phase: request.phase,
      result: { status: "found", ...smarterMailBodyMessage(message) },
    };
  }
  if (request.phase === "folder-backfill") {
    try {
      return {
        status: "ok",
        phase: request.phase,
        result: await getSmarterMailLocalBackfill(
          emailAccountId,
          provider,
          request,
        ),
      };
    } catch (error) {
      if (error instanceof InvalidMailboxSyncCursorError)
        return { status: "reset-required", phase: request.phase };
      throw error;
    }
  }
  if (request.phase === "folder-changes") {
    try {
      const page = await provider.getMailboxSyncPage({
        folderId: request.folderId,
        cursor: request.cursor,
        after: new Date(0),
        limit: request.limit,
      });
      return {
        status: "ok",
        phase: request.phase,
        result: {
          resetRequired: false,
          messages: page.upsertedMessages.map(smarterMailMetadataPatch),
          removedMessageIds: page.removedMessageIds ?? [],
          requiresReconciliationMessageIds: [],
          attachmentMetadataAvailable: false,
          cursor: page.cursor,
          hasMore: page.hasMore,
        },
      };
    } catch (error) {
      if (error instanceof InvalidMailboxSyncCursorError)
        return { status: "reset-required", phase: request.phase };
      throw error;
    }
  }
  return { status: "unsupported", strategy: "folder-delta" };
}
