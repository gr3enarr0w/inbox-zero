import { syncSmarterMailLocalMail } from "@/utils/smartermail/local-mail-sync";
import { getSmarterMailMailboxSyncPage } from "@/utils/smartermail/mailbox-sync";
import type { EmailProvider } from "@/utils/email/types";
import { SmarterMailDraftsProvider } from "@/utils/smartermail/provider/drafts";
import {
  watchSmarterMailEmails,
  unwatchSmarterMailEmails,
} from "@/utils/smartermail/watch";

export class SmarterMailProvider
  extends SmarterMailDraftsProvider
  implements EmailProvider
{
  async getMailboxSyncPage(
    options: Parameters<EmailProvider["getMailboxSyncPage"]>[0],
  ) {
    return getSmarterMailMailboxSyncPage({
      ...options,
      emailAccountId: this.emailAccountId,
      provider: this,
      verifyExistingIds: (folderId, ids) =>
        this.hasMessagesInFolder(folderId, ids),
    });
  }
  async syncLocalMail(...args: Parameters<EmailProvider["syncLocalMail"]>) {
    if (args[1].emailAccountId !== this.emailAccountId)
      throw new Error("SmarterMail local mail account scope mismatch");
    return syncSmarterMailLocalMail(this, args[0], this.emailAccountId);
  }
  async watchEmails() {
    return watchSmarterMailEmails(this.emailAccountId);
  }
  async unwatchEmails() {
    await unwatchSmarterMailEmails(this.emailAccountId);
  }
}
