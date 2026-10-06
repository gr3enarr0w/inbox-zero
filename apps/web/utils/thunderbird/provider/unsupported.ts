import type { EmailProvider } from "@/utils/email/types";
import { ThunderbirdUnsupportedError } from "@/utils/thunderbird/errors";
import { ThunderbirdProviderContext } from "@/utils/thunderbird/provider/context";
export class ThunderbirdUnsupportedProvider extends ThunderbirdProviderContext {
  blockUnsubscribedEmail: EmailProvider["blockUnsubscribedEmail"] =
    unsupported("sender blocking");
  bulkArchiveFromSenders: EmailProvider["bulkArchiveFromSenders"] = unsupported(
    "bulk sender mutations",
  );
  bulkTrashFromSenders: EmailProvider["bulkTrashFromSenders"] = unsupported(
    "bulk sender mutations",
  );
  createAutoArchiveFilter: EmailProvider["createAutoArchiveFilter"] =
    unsupported("native filters");
  createFilter: EmailProvider["createFilter"] = unsupported("native filters");
  deleteFilter: EmailProvider["deleteFilter"] = unsupported("native filters");
  deleteFolder: EmailProvider["deleteFolder"] = unsupported("folder deletion");
  deleteLabel: EmailProvider["deleteLabel"] = unsupported("folder deletion");
  deleteDraft: EmailProvider["deleteDraft"] = unsupported("draft deletion");
  forwardEmail: EmailProvider["forwardEmail"] = unsupported("sending mail");
  getAttachment: EmailProvider["getAttachment"] = unsupported(
    "attachment transfer",
  );
  getAttachmentStream: EmailProvider["getAttachmentStream"] = unsupported(
    "attachment transfer",
  );
  getContactPhotos: EmailProvider["getContactPhotos"] =
    unsupported("contact photos");
  getFiltersList: EmailProvider["getFiltersList"] =
    unsupported("native filters");
  getForwardingAddresses: EmailProvider["getForwardingAddresses"] = unsupported(
    "forwarding settings",
  );
  getSignatures: EmailProvider["getSignatures"] =
    unsupported("native signatures");
  renameFolder: EmailProvider["renameFolder"] = unsupported("folder renaming");
  replyToEmail: EmailProvider["replyToEmail"] = unsupported("sending mail");
  searchContacts: EmailProvider["searchContacts"] =
    unsupported("native contacts");
  sendDraft: EmailProvider["sendDraft"] = unsupported("sending mail");
  sendEmail: EmailProvider["sendEmail"] = unsupported("sending mail");
  sendEmailWithHtml: EmailProvider["sendEmailWithHtml"] =
    unsupported("sending mail");
  updateDraft: EmailProvider["updateDraft"] = unsupported("draft updating");
  updateLabel: EmailProvider["updateLabel"] = unsupported(
    "folder metadata updating",
  );
  getMailboxSyncPage: EmailProvider["getMailboxSyncPage"] = unsupported(
    "incremental mailbox sync",
  );
  syncLocalMail: EmailProvider["syncLocalMail"] = unsupported(
    "incremental mailbox sync",
  );
}
function unsupported(capability: string) {
  return async (..._args: unknown[]): Promise<never> => {
    throw new ThunderbirdUnsupportedError(capability);
  };
}
