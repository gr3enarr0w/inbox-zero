import { afterEach, describe, expect, it, vi } from "vitest";
import { SmarterMailTransport } from "./transport";

afterEach(() => vi.unstubAllGlobals());

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
});
