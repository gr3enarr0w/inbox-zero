import { describe, it, expect, vi } from "vitest";
import { SmarterMailProvider } from "@/utils/email/smartermail";
import { SmarterMailClient } from "@/utils/smartermail/client";
import { createScopedLogger } from "@/utils/logger";
vi.mock("server-only", () => ({}));
vi.mock("@/utils/smartermail/watch", () => ({}));

describe("SmarterMail account capabilities", () => {
  it("searches enabled personal contact books and normalizes duplicate addresses", async () => {
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com",
      tokens: { accessToken: "test", refreshToken: "test" },
    });
    const request = vi.spyOn(client, "request");
    const provider = new SmarterMailProvider(
      client,
      createScopedLogger("smartermail-contacts-test"),
      "fixture",
    );
    request
      .mockResolvedValueOnce({
        sharedLists: [
          {
            enabled: true,
            ownerUsername: "reader",
            itemID: "personal",
            displayName: "Contacts",
          },
          {
            enabled: true,
            ownerUsername: "other",
            itemID: "shared",
            displayName: "Shared",
            isSharedItem: true,
          },
        ],
      })
      .mockResolvedValueOnce({
        results: [
          {
            displayAs: "Recipient",
            emailAddressList: [
              "recipient@example.com",
              "RECIPIENT@example.com",
              "not-an-address",
            ],
          },
        ],
      });
    expect(await provider.searchContacts("Recipient")).toEqual([
      { emailAddress: "recipient@example.com", name: "Recipient" },
    ]);
    expect(request).toHaveBeenCalledWith(
      "contacts",
      expect.objectContaining({
        sources: [{ owner: "reader", id: "personal", sourceName: "Contacts" }],
      }),
    );
  });
  it("uses existing categories and refuses unsafe whole-settings replacement", async () => {
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com",
      tokens: { accessToken: "test", refreshToken: "test" },
    });
    const request = vi.spyOn(client, "request").mockResolvedValue({
      categorySettings: {
        categories: [{ name: "Receipts", guid: "fixture", colorIndex: 0 }],
      },
    });
    const provider = new SmarterMailProvider(
      client,
      createScopedLogger("smartermail-categories-test"),
      "fixture",
    );
    expect(await provider.createLabel("Receipts")).toEqual({
      id: "sm-category:Receipts",
      name: "Receipts",
      type: "user",
    });
    await expect(provider.createLabel("New category")).rejects.toThrow(
      "creating categories safely",
    );
    expect(
      request.mock.calls.every(
        ([operation]) => operation === "categorySettings",
      ),
    ).toBe(true);
  });
});
