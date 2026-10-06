import { describe, expect, it } from "vitest";
import { assertSmarterMailSuccess, getTokenExpiry } from "./tokens";

describe("SmarterMail token parsing", () => {
  it("reads expiry only as a refresh hint", () => {
    const body = Buffer.from(JSON.stringify({ exp: 1_900_000_000 })).toString(
      "base64url",
    );
    expect(getTokenExpiry(`header.${body}.signature`)).toBe(1_900_000_000_000);
  });

  it.each([
    "opaque-token",
    "header.invalid.signature",
    "",
    "header.e30.signature",
  ])("leaves expiry unknown for token %s", (token) => {
    expect(getTokenExpiry(token)).toBeUndefined();
  });

  it("never exposes server text when an operation is rejected", () => {
    expect(() =>
      assertSmarterMailSuccess({ success: false, message: "private-token" }),
    ).toThrow("SmarterMail operation was rejected");
  });
});
