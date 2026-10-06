import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { SmarterMailClient } from "@/utils/smartermail/client";
import { getSmarterMailClientForEmail } from "@/utils/smartermail/account";
import { SmarterMailCalendarEventProvider } from "@/utils/calendar/providers/smartermail-events";
import { fetchSmarterMailCalendarEvents } from "@/utils/calendar/providers/smartermail-event-read";
import { smarterMailCalendarId } from "@/utils/calendar/providers/smartermail-calendar-id";
import { createScopedLogger } from "@/utils/logger";
import * as normalization from "@/utils/calendar/providers/smartermail-event-normalization";
vi.mock("server-only", () => ({}));
vi.mock("@/utils/prisma");
vi.mock("@/utils/smartermail/account", () => ({
  getSmarterMailClientForEmail: vi.fn(),
}));
const owner = "reader@example.com";
const calendarId = smarterMailCalendarId(owner, "primary");
const source = {
  owner,
  id: "primary",
  name: "Calendar",
  isPrimary: true,
  isSharedItem: false,
  isCalendar: true,
};
const start = new Date("2026-07-01T00:00:00Z");
const end = new Date("2026-08-01T00:00:00Z");
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
const client = new SmarterMailClient({
  baseUrl: "https://mail.example.com",
  tokens: { accessToken: "fixture", refreshToken: "fixture" },
});
const request = vi.spyOn(client, "request");
const provider = new SmarterMailCalendarEventProvider(
  { emailAccountId: "fixture", connectionId: "connection" },
  createScopedLogger("calendar-test"),
);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSmarterMailClientForEmail).mockResolvedValue(client);
  prisma.calendar.findMany.mockResolvedValue([{ calendarId }] as never);
  prisma.emailAccount.findUnique.mockResolvedValue({ email: owner } as never);
});
describe("native SmarterMail calendar reads", () => {
  it("supports all 50 discovered personal calendars with sequential reads", async () => {
    const sources = Array.from({ length: 50 }, (_, index) => ({
      ...source,
      id: `calendar-${index}`,
    }));
    request
      .mockResolvedValueOnce({ calendars: sources })
      .mockResolvedValue({ events: [] });
    const events = await fetchSmarterMailCalendarEvents(
      client,
      sources.map((source) => smarterMailCalendarId(owner, source.id)),
      start,
      end,
      owner,
    );
    expect(events).toEqual([]);
    expect(request).toHaveBeenCalledTimes(51);
  });

  it("sorts events while normalizing each one only once", async () => {
    const normalize = vi.spyOn(
      normalization,
      "normalizeSmarterMailCalendarEvent",
    );
    const early = {
      ...event,
      id: 2,
      uid: "early",
      startWithTZ: { ...event.startWithTZ, date_local: "2026-07-08T08:00:00" },
    };
    request
      .mockResolvedValueOnce({ calendars: [source] })
      .mockResolvedValueOnce({ events: [event, early] });
    const events = await fetchSmarterMailCalendarEvents(
      client,
      [calendarId],
      start,
      end,
      owner,
    );
    expect(events.map((event) => event.uid)).toEqual(["early", "fixture"]);
    expect(normalize).toHaveBeenCalledTimes(2);
    normalize.mockRestore();
  });

  it("rejects an oversized combined event window instead of returning partial availability", async () => {
    request
      .mockResolvedValueOnce({
        calendars: [source, { ...source, id: "second" }],
      })
      .mockResolvedValueOnce({
        events: Array.from({ length: 5000 }, (_, index) => ({
          ...event,
          id: index + 1,
        })),
      })
      .mockResolvedValueOnce({ events: [{ ...event, calId: "second" }] });
    await expect(
      fetchSmarterMailCalendarEvents(
        client,
        [calendarId, smarterMailCalendarId(owner, "second")],
        start,
        end,
        owner,
      ),
    ).rejects.toThrow("exceeds 5000");
  });
  it("uses enabled account-scoped calendars and filters cancelled occurrences", async () => {
    request
      .mockResolvedValueOnce({ calendars: [source] })
      .mockResolvedValueOnce({
        events: [event, { ...event, id: 2, status: 2 }],
      })
      .mockResolvedValueOnce({
        details: {
          id: 0,
          uid: "fixture",
          calendarOwner: owner,
          calendarId: "primary",
          attendees: [{ email: "attendee@example.com" }],
        },
      });
    const events = await provider.fetchEventsWithAttendee({
      attendeeEmail: "ATTENDEE@example.com",
      timeMin: start,
      timeMax: end,
      maxResults: 10,
    });
    expect(events).toHaveLength(1);
    expect(prisma.calendar.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          connection: expect.objectContaining({
            emailAccountId: "fixture",
            id: "connection",
            isConnected: true,
          }),
        }),
      }),
    );
    expect(request).toHaveBeenCalledWith("calendarEvents", expect.anything(), {
      owner,
      id: "primary",
    });
  });
  it("rejects other owners and event scope mismatches before returning partial availability", async () => {
    request.mockResolvedValueOnce({
      calendars: [{ ...source, owner: "other@example.com" }],
    });
    await expect(
      fetchSmarterMailCalendarEvents(client, [calendarId], start, end, owner),
    ).rejects.toThrow("unavailable");
    expect(request).toHaveBeenCalledTimes(1);
    request
      .mockResolvedValueOnce({ calendars: [source] })
      .mockResolvedValueOnce({
        events: [{ ...event, owner: "other@example.com" }],
      });
    await expect(
      fetchSmarterMailCalendarEvents(client, [calendarId], start, end, owner),
    ).rejects.toThrow("scope mismatch");
  });
  it("rejects invalid limits and unsupported mutations before network activity", async () => {
    await expect(
      fetchSmarterMailCalendarEvents(
        client,
        new Array<string>(51).fill(calendarId),
        start,
        end,
        owner,
      ),
    ).rejects.toThrow("Too many SmarterMail calendars");
    await expect(provider.fetchEvents({ maxResults: 26 })).rejects.toThrow(
      "25",
    );
    await expect(
      provider.fetchEventsWithAttendee({
        attendeeEmail: owner,
        timeMin: start,
        timeMax: end,
        maxResults: -1,
      }),
    ).rejects.toThrow("25");
    await expect(provider.createEvent({} as never)).rejects.toThrow(
      "not supported",
    );
    await expect(provider.cancelEvent({} as never)).rejects.toThrow(
      "not supported",
    );
    expect(request).not.toHaveBeenCalled();
  });
});
