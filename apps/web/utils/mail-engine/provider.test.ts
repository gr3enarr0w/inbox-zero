import { describe, expect, it } from "vitest";
import { getMailEngineProvider } from "./provider";

describe("mail engine provider boundary", () => {
  it("preserves native identities instead of falling back to Gmail", () => {
    expect(getMailEngineProvider("thunderbird")).toBe("thunderbird");
    expect(getMailEngineProvider("smartermail")).toBe("smartermail");
    expect(getMailEngineProvider("microsoft")).toBe("microsoft");
    expect(getMailEngineProvider("google")).toBe("google");
    expect(getMailEngineProvider("imap")).toBeNull();
    expect(getMailEngineProvider("")).toBeNull();
  });
});
