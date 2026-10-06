import { describe, it, expect, vi } from "vitest";
import { SmarterMailProvider } from "@/utils/email/smartermail";
import { SmarterMailClient } from "@/utils/smartermail/client";
import { createScopedLogger } from "@/utils/logger";
vi.mock("server-only", () => ({}));
vi.mock("@/utils/smartermail/watch", () => ({}));

describe("SmarterMail draft autosave", () => {
  it("resolves the latest UID from stable MID before updating or deleting", async () => {
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com",
      tokens: { accessToken: "test", refreshToken: "test" },
    });
    const request = vi.spyOn(client, "request");
    const provider = new SmarterMailProvider(
      client,
      createScopedLogger("smartermail-draft-test"),
      "fixture",
    );
    request
      .mockResolvedValueOnce({ folderList: [{ path: "Drafts" }] })
      .mockResolvedValueOnce({ uid: 7, mid: 123 });
    const draft = await provider.createDraft({
      to: "recipient@example.com",
      subject: "Fixture",
      messageHtml: "Initial",
    });
    expect(draft.id).toBe("sm-draft:123");
    request
      .mockResolvedValueOnce({ folderList: [{ path: "Drafts" }] })
      .mockResolvedValueOnce({
        messageData: {
          uid: 9,
          mid: 123,
          folder: "Drafts",
          isDraft: true,
          date: "2026-01-01T00:00:00Z",
          to: "recipient@example.com",
          subject: "Fixture",
          messageHTML: "Initial",
        },
      })
      .mockResolvedValueOnce({ uid: 10, mid: 123 });
    await provider.updateDraft(draft.id, { messageHtml: "Updated" });
    expect(request).toHaveBeenCalledWith("message", {
      folder: "Drafts",
      mid: 123,
    });
    expect(request).toHaveBeenCalledWith(
      "saveDraft",
      expect.objectContaining({
        folder: "Drafts",
        draftUid: 9,
        messageHTML: "Updated",
      }),
    );
    request
      .mockResolvedValueOnce({ folderList: [{ path: "Drafts" }] })
      .mockResolvedValueOnce({
        messageData: {
          uid: 10,
          mid: 123,
          folder: "Drafts",
          isDraft: true,
          date: "2026-01-01T00:00:00Z",
        },
      })
      .mockResolvedValueOnce({ success: true });
    await provider.deleteDraft(draft.id);
    expect(request).toHaveBeenCalledWith("deleteMessages", {
      folder: "Drafts",
      uID: [10],
      all: false,
      moveToDeleted: false,
    });
  });
});
