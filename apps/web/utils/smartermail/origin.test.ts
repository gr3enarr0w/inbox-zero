import { describe, expect, it } from "vitest";
import { validateSmarterMailOrigin } from "@/utils/smartermail/origin";

describe("SmarterMail server trust boundary", () => {
  it("rejects servers unless the administrator explicitly trusts the exact origin", () => {
    expect(() =>
      validateSmarterMailOrigin("https://mail.example.com", undefined),
    ).toThrow();
    expect(() =>
      validateSmarterMailOrigin(
        "https://mail.example.com.attacker.test",
        "https://mail.example.com",
      ),
    ).toThrow();
    expect(() =>
      validateSmarterMailOrigin(
        "https://mail.example.com:444",
        "https://mail.example.com",
      ),
    ).toThrow();
    expect(() =>
      validateSmarterMailOrigin(
        "https://127.0.0.1",
        "https://mail.example.com",
      ),
    ).toThrow();
  });
  it("accepts explicitly trusted HTTPS origins, including self-hosted addresses", () => {
    expect(
      validateSmarterMailOrigin(
        "https://mail.example.com/",
        "https://other.example.com, https://mail.example.com",
      ),
    ).toBe("https://mail.example.com");
    expect(
      validateSmarterMailOrigin(
        "https://192.0.2.10:8443",
        "https://192.0.2.10:8443",
      ),
    ).toBe("https://192.0.2.10:8443");
  });
  it.each([
    "http://mail.example.com",
    "https://user:password@mail.example.com",
    "https://mail.example.com/api",
    "https://mail.example.com?server=x",
    "https://mail.example.com#x",
    "not-a-url",
  ])("rejects ambiguous or insecure URL %s", (input) => {
    expect(() => validateSmarterMailOrigin(input, input)).toThrow();
  });
});
