import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SmarterMailTransport } from "./transport";
import { withSmarterMailLocalSyncContext } from "./local-sync-context";
import { withLocalMailSyncBudget } from "@/utils/email/local-mail-sync-budget";

vi.mock("@/utils/redis", () => ({ redis: { eval: vi.fn() } }));
vi.mock("@/utils/email/local-mail-sync-budget", async (original) => ({
  ...(await original<typeof import("@/utils/email/local-mail-sync-budget")>()),
  withLocalMailSyncBudget: vi.fn(),
}));
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(() =>
    Promise.resolve(Response.json({ success: true })),
  );
  vi.mocked(withLocalMailSyncBudget).mockImplementation((_input, operation) =>
    operation(new AbortController().signal),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("SmarterMail local sync HTTP admission", () => {
  it("reserves each actual HTTP read including hydration independently", async () => {
    const transport = new SmarterMailTransport("https://mail.example.com");
    await withSmarterMailLocalSyncContext("account", "backfill", async () => {
      await transport.request("mail/messages", "POST");
      await transport.request("mail/message", "POST");
    });
    expect(withLocalMailSyncBudget).toHaveBeenCalledTimes(2);
    expect(withLocalMailSyncBudget).toHaveBeenCalledWith(
      {
        emailAccountId: "account",
        provider: "smartermail",
        priority: "backfill",
        cost: 1,
      },
      expect.any(Function),
    );
  });

  it("fails without contacting the mail server for unexpected admission errors", async () => {
    vi.mocked(withLocalMailSyncBudget).mockRejectedValueOnce(
      new Error("paused"),
    );
    await expect(
      withSmarterMailLocalSyncContext("account", "current", () =>
        new SmarterMailTransport("https://mail.example.com").request(
          "mail/messages",
          "POST",
        ),
      ),
    ).rejects.toThrow("paused");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves automation requests outside the local sync scope", async () => {
    await new SmarterMailTransport("https://mail.example.com").request(
      "mail/message",
      "POST",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(withLocalMailSyncBudget).not.toHaveBeenCalled();
  });
});
