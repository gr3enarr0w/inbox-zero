export const operations = {
  folders: {
    method: "GET",
    path: "folders/list-email-folders",
    readOnly: true,
  },
  messages: { method: "POST", path: "mail/messages", readOnly: true },
  messageMetadata: {
    method: "POST",
    path: "mail/messagemetadata",
    readOnly: true,
  },
  messagesUid: { method: "POST", path: "mail/messages-uid", readOnly: true },
  message: { method: "POST", path: "mail/message", readOnly: true },
  search: { method: "POST", path: "mail/search", readOnly: true },
  contactSources: { method: "GET", path: "contacts/sources", readOnly: true },
  contacts: { method: "POST", path: "contacts/contacts-all", readOnly: true },
  calendarSources: { method: "GET", path: "calendars/sources", readOnly: true },
  calendarEvents: {
    method: "POST",
    path: "calendars/events/:owner/:id",
    readOnly: true,
  },
  calendarEvent: {
    method: "GET",
    path: "calendars/events/:owner/:calId/:eventId",
    readOnly: true,
  },
  categories: { method: "GET", path: "user-categories", readOnly: true },
  categorySettings: {
    method: "GET",
    path: "categories/user-category-settings",
    readOnly: true,
  },
  updateCategorySettings: {
    method: "POST",
    path: "categories/user-category-settings",
    readOnly: false,
  },
  patchMessageCategories: {
    method: "POST",
    path: "mail/messages-category-patch",
    readOnly: false,
  },
  addFolder: { method: "POST", path: "folders/folder-put", readOnly: false },
  deleteFolder: {
    method: "POST",
    path: "folders/delete-folder",
    readOnly: false,
  },
  editFolder: { method: "POST", path: "folders/folder-patch", readOnly: false },
  deleteMessages: {
    method: "POST",
    path: "mail/delete-messages",
    readOnly: false,
  },
  moveMessages: { method: "POST", path: "mail/move-messages", readOnly: false },
  patchMessages: {
    method: "POST",
    path: "mail/messages-patch",
    readOnly: false,
  },
  saveDraft: { method: "POST", path: "mail/draft-put", readOnly: false },
  sendMessage: { method: "POST", path: "mail/message-put", readOnly: false },
} as const;

export type SmarterMailOperation = keyof typeof operations;
