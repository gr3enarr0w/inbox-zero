import { describe, expect, it } from "vitest";
import { getMailEngineProvider } from "./provider";

describe("mail engine provider boundary", () => {
  it("admits only providers with local mailbox synchronization support", () => {
    expect(getMailEngineProvider("thunderbird")).toBeNull();
    expect(getMailEngineProvider("smartermail")).toBe("smartermail");
    expect(getMailEngineProvider("microsoft")).toBe("microsoft");
    expect(getMailEngineProvider("google")).toBe("google");
    expect(getMailEngineProvider("imap")).toBeNull();
    expect(getMailEngineProvider("")).toBeNull();
  });
});
