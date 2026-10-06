import { describe, it, expect, vi } from "vitest";
import { SmarterMailClient } from "@/utils/smartermail/client";
import { hydrateSmarterMailCalendarEvents } from "@/utils/calendar/providers/smartermail-event-detail";
const owner = "reader";
const event = {
  owner,
  calId: "primary",
  id: 1,
  uid: "fixture",
  title: "Fixture",
  status: 1,
  startWithTZ: {
    date_local: "2026-07-08T09:00:00",
    time_zone_id: "UTC",
    has_time: true,
  },
  endWithTZ: {
    date_local: "2026-07-08T10:00:00",
    time_zone_id: "UTC",
    has_time: true,
  },
};
const detail = {
  id: 0,
  uid: "fixture",
  calendarOwner: owner,
  calendarId: "primary",
  attendees: [{ email: "attendee@example.com" }],
};
describe("SmarterMail detail identity", () => {
  it("accepts a zero read-detail ID only with matching stable UID and scope", async () => {
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com",
      tokens: { accessToken: "fixture", refreshToken: "fixture" },
    });
    vi.spyOn(client, "request").mockResolvedValue({ details: detail });
    const result = await hydrateSmarterMailCalendarEvents(client, [event]);
    expect(result[0].attendees[0].email).toBe("attendee@example.com");
  });
  it.each([
    { uid: "unrelated" },
    { calendarOwner: "other" },
    { calendarId: "other" },
    { id: 2 },
  ])("rejects unrelated detail identity %j", async (patch) => {
    const client = new SmarterMailClient({
      baseUrl: "https://mail.example.com",
      tokens: { accessToken: "fixture", refreshToken: "fixture" },
    });
    vi.spyOn(client, "request").mockResolvedValue({
      details: { ...detail, ...patch },
    });
    await expect(
      hydrateSmarterMailCalendarEvents(client, [event]),
    ).rejects.toThrow("scope mismatch");
  });
});
