import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach } from "vitest";
const { provider } = vi.hoisted(() => ({
  provider: { name: "smartermail", getFolders: vi.fn() },
}));
vi.mock("@/utils/middleware", () => ({
  withEmailProvider:
    (
      _name: string,
      handler: (request: {
        emailProvider: typeof provider;
      }) => Promise<Response>,
    ) =>
    () =>
      handler({ emailProvider: provider }),
}));
import { GET } from "./route";

describe("folder-capable provider route", () => {
  beforeEach(() => {
    provider.name = "smartermail";
    provider.getFolders.mockReset();
  });
  it("returns native SmarterMail folders through the shared provider", async () => {
    const folders = [
      { id: "Inbox/Receipts", displayName: "Receipts", childFolders: [] },
    ];
    provider.getFolders.mockResolvedValue(folders);
    const response = await GET(
      new NextRequest("https://app.example.com/api/user/folders"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(folders);
  });
  it("does not invoke unsupported Gmail folder operations", async () => {
    provider.name = "google";
    const response = await GET(
      new NextRequest("https://app.example.com/api/user/folders"),
    );
    expect(response.status).toBe(400);
    expect(provider.getFolders).not.toHaveBeenCalled();
  });
});
