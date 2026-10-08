import { describe, it, expect } from "vitest";
import {
  smarterMailDate,
  smarterMailDateSchema,
  normalizeSmarterMailCalendarEvent,
} from "@/utils/calendar/providers/smartermail-event-normalization";

const date = (date_local: string, time_zone_id = "Eastern Standard Time") => ({
  date_local,
  time_zone_id,
  has_time: true,
});
describe("SmarterMail calendar timezone normalization", () => {
  it("maps Windows timezone names with summer and winter offsets", () => {
    expect(
      smarterMailDate(
        smarterMailDateSchema.parse({
          dt: "2026-07-01T09:00:00",
          tz: "Eastern Standard Time",
          has_time: true,
        }),
      ).toISOString(),
    ).toBe("2026-07-01T13:00:00.000Z");
    expect(smarterMailDate(date("2026-07-01T09:00:00")).toISOString()).toBe(
      "2026-07-01T13:00:00.000Z",
    );
    expect(smarterMailDate(date("2026-01-01T09:00:00")).toISOString()).toBe(
      "2026-01-01T14:00:00.000Z",
    );
    expect(
      smarterMailDate(date("2026-07-01T09:00:00.1234567-04:00")).toISOString(),
    ).toBe("2026-07-01T13:00:00.123Z");
  });
  it.each([
    "2026-02-30T09:00:00",
    "2026-01-01T25:00:00",
    "2026-01-01T09:00:00garbage",
    "2026-03-08T02:30:00",
  ])("rejects malformed or nonexistent date %s", (value) => {
    expect(() => smarterMailDate(date(value))).toThrow(
      "Invalid SmarterMail event date",
    );
  });
  it("preserves expanded recurrence times instead of the series detail start", () => {
    const event = {
      id: 1,
      uid: "fixture",
      title: "Recurring",
      status: 1,
      owner: "reader@example.com",
      calId: "primary",
      startWithTZ: date("2026-07-08T09:00:00"),
      endWithTZ: date("2026-07-08T10:00:00"),
    };
    const detail = {
      id: 0,
      uid: "fixture",
      calendarOwner: event.owner,
      calendarId: event.calId,
      description: "Fixture",
      attendees: [{ email: "attendee@example.com" }],
    };
    const normalized = normalizeSmarterMailCalendarEvent(event, detail);
    expect(normalized.id).not.toBe(
      normalizeSmarterMailCalendarEvent({ ...event, calId: "other" }).id,
    );
    expect(normalized.startTime.toISOString()).toBe("2026-07-08T13:00:00.000Z");
    expect(normalized.attendees).toEqual([
      { email: "attendee@example.com", name: undefined },
    ]);
    expect(normalized.id).not.toBe(
      normalizeSmarterMailCalendarEvent({
        ...event,
        startWithTZ: date("2026-07-09T09:00:00"),
        endWithTZ: date("2026-07-09T10:00:00"),
      }).id,
    );
    expect(() =>
      smarterMailDate(date("2026-01-01T09:00:00", "Missing timezone")),
    ).toThrow("Unsupported");
  });
});
