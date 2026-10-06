import { describe, expect, it, vi } from "vitest";
import { fetchSmarterMailFolderPage } from "./folder-page";

function fixture() {
  const request = vi.fn();
  return {
    request,
    options: {
      client: { request },
      folders: ["Sent Items", "Inbox"],
      body: { query: "fixture", searchFlags: { 0: false } },
      scope: "account",
      take: 2,
    },
  };
}

describe("SmarterMail owned folder pagination", () => {
  it("fills a page across sorted folders without a false global request", async () => {
    const { request, options } = fixture();
    request
      .mockResolvedValueOnce({ results: [{ uid: 1, folder: "Inbox" }] })
      .mockResolvedValueOnce({ results: [{ uid: 1, folder: "Sent Items" }] });
    const page = await fetchSmarterMailFolderPage(options);
    expect(page.results.map((row) => row.folder)).toEqual([
      "Inbox",
      "Sent Items",
    ]);
    expect(request.mock.calls).toEqual([
      [
        "search",
        {
          ...options.body,
          folder: "Inbox",
          includeSubFolders: false,
          skip: 0,
          take: 2,
        },
      ],
      [
        "search",
        {
          ...options.body,
          folder: "Sent Items",
          includeSubFolders: false,
          skip: 0,
          take: 1,
        },
      ],
    ]);
    request.mockResolvedValueOnce({
      results: [{ uid: 2, folder: "Sent Items" }],
    });
    const next = await fetchSmarterMailFolderPage({
      ...options,
      folders: ["Inbox", "Sent Items"],
      body: { searchFlags: { 0: false }, query: "fixture" },
      pageToken: page.nextPageToken,
    });
    expect(request.mock.calls[2][1]).toMatchObject({
      folder: "Sent Items",
      skip: 1,
    });
    expect(next.results.map((row) => row.uid)).toEqual([2]);
    expect(next.nextPageToken).toBeUndefined();
  });

  it("binds cursors to scope, inventory and filters before contacting the provider", async () => {
    const { request, options } = fixture();
    request.mockResolvedValueOnce({
      results: [
        { uid: 1, folder: "Inbox" },
        { uid: 2, folder: "Inbox" },
      ],
    });
    const page = await fetchSmarterMailFolderPage(options);
    request.mockClear();
    for (const patch of [
      { scope: "other" },
      { folders: ["Inbox"] },
      { body: { query: "different" } },
    ])
      await expect(
        fetchSmarterMailFolderPage({
          ...options,
          ...patch,
          pageToken: page.nextPageToken,
        }),
      ).rejects.toThrow("scope changed");
    await expect(
      fetchSmarterMailFolderPage({ ...options, pageToken: "1" }),
    ).rejects.toThrow("page token");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects oversized responses and foreign-folder rows", async () => {
    const { request, options } = fixture();
    request.mockResolvedValueOnce({ results: [{ uid: 1, folder: "Other" }] });
    await expect(fetchSmarterMailFolderPage(options)).rejects.toThrow(
      "folder scope",
    );
    request.mockResolvedValueOnce({
      results: [1, 2, 3].map((uid) => ({ uid, folder: "Inbox" })),
    });
    await expect(fetchSmarterMailFolderPage(options)).rejects.toThrow(
      "page size",
    );
  });
  it("resumes bounded pages across a large inventory even when earlier folders are empty", async () => {
    const { request, options } = fixture();
    const folders = Array.from(
      { length: 45 },
      (_, index) => `Folder${String(index).padStart(2, "0")}`,
    );
    request.mockImplementation(async (_operation, body) => ({
      results: body.folder === "Folder44" ? [{ uid: 55 }] : [],
    }));
    let page = await fetchSmarterMailFolderPage({ ...options, folders });
    expect(page.results).toEqual([]);
    expect(page.nextPageToken).toBeDefined();
    expect(request).toHaveBeenCalledTimes(20);
    request.mockClear();
    page = await fetchSmarterMailFolderPage({
      ...options,
      folders,
      pageToken: page.nextPageToken,
    });
    expect(page.results).toEqual([]);
    expect(page.nextPageToken).toBeDefined();
    expect(request).toHaveBeenCalledTimes(20);
    request.mockClear();
    page = await fetchSmarterMailFolderPage({
      ...options,
      folders,
      pageToken: page.nextPageToken,
    });
    expect(page.results).toEqual([{ uid: 55, folder: "Folder44" }]);
    expect(page.nextPageToken).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(5);
  });

  it("stops before another folder query when cancellation arrives", async () => {
    const { request, options } = fixture();
    const controller = new AbortController();
    request.mockImplementationOnce(async () => {
      controller.abort();
      return { results: [] };
    });
    await expect(
      fetchSmarterMailFolderPage({ ...options, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(request).toHaveBeenCalledOnce();
  });

  it("uses the requested scope when a scoped search omits its folder field", async () => {
    const { request, options } = fixture();
    request.mockResolvedValueOnce({ results: [{ uid: 7 }] });
    const page = await fetchSmarterMailFolderPage({
      ...options,
      folders: ["Sent Items"],
    });
    expect(page.results).toEqual([{ uid: 7, folder: "Sent Items" }]);
    expect(page.nextPageToken).toBeUndefined();
  });

  it("skips empty folders and terminates without a misleading short intermediate page", async () => {
    const { request, options } = fixture();
    request
      .mockResolvedValueOnce({ results: [] })
      .mockResolvedValueOnce({ results: [] });
    expect(await fetchSmarterMailFolderPage(options)).toEqual({
      results: [],
      nextPageToken: undefined,
    });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
