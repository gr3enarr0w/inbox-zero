import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SmarterMailTransport } from "./transport";
import { getSmarterMailLocalSyncContext } from "./local-sync-context";
import {
  LocalMailSyncPausedError,
  withLocalMailSyncBudget,
} from "@/utils/email/local-mail-sync-budget";

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => vi.resetAllMocks());

vi.mock("@/utils/redis", () => ({ redis: { eval: vi.fn() } }));
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn() }));
vi.mock("./local-sync-context", () => ({
  getSmarterMailLocalSyncContext: vi.fn(),
}));
vi.mock("@/utils/email/local-mail-sync-budget", async (original) => ({
  ...(await original<typeof import("@/utils/email/local-mail-sync-budget")>()),
  withLocalMailSyncBudget: vi.fn(),
}));

describe("SmarterMail transport", () => {
  it("does not follow a redirect carrying credentials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("secret", { status: 302 }));
    vi.stubGlobal("fetch", fetchMock);
    const transport = new SmarterMailTransport("https://mail.example.com");
    await expect(
      transport.request("mail/messages", "POST", {}, "secret"),
    ).rejects.toThrow("SmarterMail request failed (302)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
  });

  it.each([
    "http://mail.example.com",
    "https://user:password@mail.example.com",
    "not-a-url",
  ])("rejects unsafe URL %s", (url) => {
    expect(() => new SmarterMailTransport(url)).toThrow();
  });

  it("hides server error bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("private-password", { status: 500 })),
    );
    await expect(
      new SmarterMailTransport("https://mail.example.com").request(
        "mail/message",
        "POST",
      ),
    ).rejects.toThrow("SmarterMail request failed (500)");
  });
  it("waits for admission without restarting an unfinished page or replaying HTTP", async () => {
    const signal = new AbortController().signal;
    vi.mocked(getSmarterMailLocalSyncContext).mockReturnValue({
      emailAccountId: "account",
      priority: "current",
      signal,
    });
    vi.mocked(withLocalMailSyncBudget)
      .mockRejectedValueOnce(new LocalMailSyncPausedError(1000))
      .mockImplementation(async (_input, operation) => operation(signal));
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await new SmarterMailTransport("https://mail.example.com").request(
      "mail/messages",
      "POST",
    );
    expect(delay).toHaveBeenCalledWith(1000, undefined, { signal });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(withLocalMailSyncBudget).toHaveBeenCalledTimes(2);
  });
  it("never retries a provider call that already started", async () => {
    const signal = new AbortController().signal;
    vi.mocked(getSmarterMailLocalSyncContext).mockReturnValue({
      emailAccountId: "account",
      priority: "current",
      signal,
    });
    vi.mocked(withLocalMailSyncBudget).mockImplementation(
      async (_input, operation) => {
        await operation(signal);
        throw new LocalMailSyncPausedError();
      },
    );
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new SmarterMailTransport("https://mail.example.com").request(
        "mail/messages",
        "POST",
      ),
    ).rejects.toBeInstanceOf(LocalMailSyncPausedError);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(delay).not.toHaveBeenCalled();
  });
  it("stops admission waits when the scoped deadline aborts", async () => {
    const signal = new AbortController().signal;
    vi.mocked(getSmarterMailLocalSyncContext).mockReturnValue({
      emailAccountId: "account",
      priority: "current",
      signal,
    });
    vi.mocked(withLocalMailSyncBudget).mockRejectedValue(
      new LocalMailSyncPausedError(),
    );
    vi.mocked(delay).mockRejectedValueOnce(
      new DOMException("deadline", "AbortError"),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new SmarterMailTransport("https://mail.example.com").request(
        "mail/messages",
        "POST",
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(withLocalMailSyncBudget).toHaveBeenCalledOnce();
  });
});
