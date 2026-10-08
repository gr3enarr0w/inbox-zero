import { describe, expect, it, vi } from "vitest";
import { fetchSmarterMailStatsUids } from "./stats-uids";
import { InvalidMailboxSyncCursorError } from "@/utils/email/mailbox-sync";
import { SmarterMailClient } from "@/utils/smartermail/client";
import { SmarterMailProvider } from "@/utils/email/smartermail";
import { createScopedLogger } from "@/utils/logger";
vi.mock("server-only", () => ({}));
vi.mock("@/utils/smartermail/watch", () => ({}));
describe("SmarterMail bounded UID inventory", () => {
  it("continues by scoped offsets without downloading cached message bodies", async () => {
    const { request, options } = fixture();
    request
      .mockResolvedValueOnce({ success: true, totalCount: 3, results: [7, 9] })
      .mockResolvedValueOnce({ success: true, totalCount: 3, results: [11] });
    const first = await fetchSmarterMailStatsUids(options);
    const last = await fetchSmarterMailStatsUids({
      ...options,
      pageToken: first.nextPageToken,
    });
    expect(first.uids).toEqual([7, 9]);
    expect(last).toEqual({ uids: [11], total: 3, nextPageToken: undefined });
    expect(request.mock.calls).toEqual([
      [
        "messagesUid",
        {
          folder: "Inbox",
          query: "",
          includeSubFolders: false,
          skip: 0,
          take: 2,
        },
      ],
      [
        "messagesUid",
        {
          folder: "Inbox",
          query: "",
          includeSubFolders: false,
          skip: 2,
          take: 2,
        },
      ],
    ]);
  });
  it.each([
    { scope: "other" },
    { folderId: "other" },
    { guid: "replacement" },
  ])("invalidates only a changed cursor binding before network IO", async (patch) => {
    const { request, options } = fixture();
    request.mockResolvedValue({
      success: true,
      totalCount: 3,
      results: [1, 2],
    });
    const page = await fetchSmarterMailStatsUids(options);
    request.mockClear();
    await expect(
      fetchSmarterMailStatsUids({
        ...options,
        ...patch,
        pageToken: page.nextPageToken,
      }),
    ).rejects.toBeInstanceOf(InvalidMailboxSyncCursorError);
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    { totalCount: 3, results: [] },
    { totalCount: 3, results: [1, 1] },
    { totalCount: 1, results: [1, 2] },
    { totalCount: 3, results: [1, 2, 3] },
    { totalCount: 2, results: [0, 1] },
  ])("rejects inconclusive inventories rather than claiming completion", async (payload) => {
    const { request, options } = fixture();
    request.mockResolvedValue({ success: true, ...payload });
    await expect(fetchSmarterMailStatsUids(options)).rejects.toThrow();
  });
  it("keeps a sparse page resumable until the reported total is reached", async () => {
    const { request, options } = fixture();
    request.mockResolvedValue({ success: true, totalCount: 3, results: [1] });
    expect((await fetchSmarterMailStatsUids(options)).nextPageToken).toMatch(
      /^sm-uids:/,
    );
  });
  it("rejects a folder outside the owned inventory before native UID lookup", async () => {
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com",
      tokens: { accessToken: "test", refreshToken: "test" },
    });
    const request = vi.spyOn(client, "request").mockResolvedValue({
      folderList: [
        { path: "Inbox", guid: "owned" },
        { path: "Shared", isMappedFolder: true },
      ],
    });
    const provider = new SmarterMailProvider(
      client,
      createScopedLogger("stats-uids-test"),
      "account",
    );
    await expect(
      provider.getStatsFolderUids({ folderId: "Shared" }),
    ).rejects.toThrow("not owned");
    expect(request.mock.calls.map((call) => call[0])).toEqual(["folders"]);
  });
});
function fixture() {
  const request = vi.fn();
  return {
    request,
    options: {
      client: { request },
      scope: "account",
      folderId: "Inbox",
      guid: "guid",
      maxResults: 2,
    },
  };
}
