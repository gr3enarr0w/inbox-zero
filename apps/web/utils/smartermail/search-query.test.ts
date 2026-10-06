import { describe, expect, it } from "vitest";
import { compileSmarterMailSearch } from "@/utils/smartermail/search-query";

describe("SmarterMail assistant search filters", () => {
  it("translates inbox triage filters without searching for the operator text", () => {
    expect(
      compileSmarterMailSearch(
        "in:inbox is:unread after:2026/10/06 before:2026/10/07",
      ),
    ).toEqual({
      query: "",
      role: "INBOX",
      read: false,
      after: new Date("2026-10-06T00:00:00Z"),
      before: new Date("2026-10-07T00:00:00Z"),
    });
  });
  it("preserves quoted categories and text alongside flags", () => {
    expect(
      compileSmarterMailSearch(
        'label:"Action Needed" is:starred has:attachment invoice',
      ),
    ).toEqual({
      query: "invoice",
      category: "Action Needed",
      starred: true,
      hasAttachment: true,
    });
  });
  it("bounds relative dates using the request time", () => {
    expect(
      compileSmarterMailSearch(
        "newer_than:2d older_than:1d",
        new Date("2026-10-06T12:00:00Z"),
      ),
    ).toEqual({
      query: "",
      after: new Date("2026-10-04T00:00:00Z"),
      before: new Date("2026-10-05T00:00:00Z"),
    });
  });
  it("keeps relative filter boundaries stable while paginating within a UTC day", () => {
    expect(
      compileSmarterMailSearch(
        "newer_than:2d",
        new Date("2026-10-06T12:00:00Z"),
      ),
    ).toEqual(
      compileSmarterMailSearch(
        "newer_than:2d",
        new Date("2026-10-06T12:01:00Z"),
      ),
    );
  });
  it.each([
    "in:inbox in:sent",
    "is:read is:unread",
    "after:2026/02/30",
    "-is:unread",
    "from:a@example.com from:b@example.com",
    "subject:invoice",
    "invoice OR receipt",
    'label:"unfinished',
  ])("rejects unsupported or ambiguous filters rather than widening: %s", (query) => {
    expect(() => compileSmarterMailSearch(query)).toThrow();
  });
  it("keeps quoted literal operator text as text", () => {
    expect(compileSmarterMailSearch('"is:unread"')).toEqual({
      query: '"is:unread"',
    });
  });
});
