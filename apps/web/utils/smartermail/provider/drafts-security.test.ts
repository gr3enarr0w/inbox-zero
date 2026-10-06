import { smarterMailMessageId } from "@/utils/smartermail/message";
import { describe, it, expect, vi } from "vitest";
import { SmarterMailProvider } from "@/utils/email/smartermail";
import { SmarterMailClient } from "@/utils/smartermail/client";
import { createScopedLogger } from "@/utils/logger";
vi.mock("server-only", () => ({}));
vi.mock("@/utils/smartermail/watch", () => ({}));

describe("SmarterMail draft mutation scope", () => {
  it.each([
    { folder: "Sent Items", isDraft: true },
    { folder: "Drafts", isDraft: false },
    { folder: "Drafts" },
  ])("rejects unsafe MID resolution before updating or deleting: %j", async (fields) => {
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com",
      tokens: { accessToken: "test", refreshToken: "test" },
    });
    const request = vi
      .spyOn(client, "request")
      .mockImplementation(async (operation) => {
        if (operation === "folders")
          return { folderList: [{ path: "Drafts" }] };
        if (operation === "message")
          return {
            messageData: {
              uid: 9,
              mid: 123,
              date: "2026-01-01T00:00:00Z",
              ...fields,
            },
          };
        throw new Error("Unexpected mailbox mutation");
      });
    const provider = new SmarterMailProvider(
      client,
      createScopedLogger("smartermail-draft-scope-test"),
      "fixture",
    );
    await expect(
      provider.updateDraft("sm-draft:123", { messageHtml: "Updated" }),
    ).rejects.toThrow();
    await expect(provider.deleteDraft("sm-draft:123")).rejects.toThrow();
    await expect(
      provider.deleteDraft(smarterMailMessageId("Drafts", 9)),
    ).rejects.toThrow();
    expect(
      request.mock.calls.some(
        ([operation]) =>
          operation === "saveDraft" || operation === "deleteMessages",
      ),
    ).toBe(false);
  });
  it.each([
    { id: "sm-draft:123", uid: 9, mid: 999 },
    { id: smarterMailMessageId("Drafts", 9), uid: 999, mid: 123 },
  ])("rejects a resolved identity mismatch: %j", async ({ id, uid, mid }) => {
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com",
      tokens: { accessToken: "test", refreshToken: "test" },
    });
    const request = vi
      .spyOn(client, "request")
      .mockImplementation(async (operation) =>
        operation === "folders"
          ? { folderList: [{ path: "Drafts" }] }
          : {
              messageData: {
                uid,
                mid,
                folder: "Drafts",
                isDraft: true,
                date: "2026-01-01T00:00:00Z",
              },
            },
      );
    const provider = new SmarterMailProvider(
      client,
      createScopedLogger("smartermail-draft-identity-test"),
      "fixture",
    );
    await expect(
      provider.updateDraft(id, { messageHtml: "Updated" }),
    ).rejects.toThrow();
    await expect(provider.deleteDraft(id)).rejects.toThrow();
    expect(
      request.mock.calls.some(
        ([operation]) =>
          operation === "saveDraft" || operation === "deleteMessages",
      ),
    ).toBe(false);
  });
});
