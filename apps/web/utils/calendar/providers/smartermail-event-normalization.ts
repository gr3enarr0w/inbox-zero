import { z } from "zod";
import { TZDate } from "@date-fns/tz";
import { findIana } from "windows-iana";
import type { CalendarEvent } from "@/utils/calendar/event-types";

export const smarterMailDateSchema = z.union([
  z.object({
    date_local: z.string(),
    time_zone_id: z.string(),
    has_time: z.boolean(),
  }),
  z
    .object({ dt: z.string(), tz: z.string(), has_time: z.boolean() })
    .transform((value) => ({
      date_local: value.dt,
      time_zone_id: value.tz,
      has_time: value.has_time,
    })),
]);
export const smarterMailEventSchema = z.object({
  id: z.number().int().positive(),
  uid: z.string(),
  title: z.string(),
  startWithTZ: smarterMailDateSchema,
  endWithTZ: smarterMailDateSchema,
  owner: z.string(),
  calId: z.string(),
  status: z.number().int(),
  occurrenceId: z.string().nullable().optional(),
  isRecurring: z.boolean().optional(),
  location: z.string().nullable().optional(),
  isTask: z.boolean().optional(),
  organizer: z
    .object({ address: z.string(), isOrganizer: z.boolean() })
    .optional(),
});
export const smarterMailEventDetailsSchema = z
  .object({
    id: z.number().int().nonnegative(),
    uid: z.string().min(1),
    calendarOwner: z.string(),
    calendarId: z.string(),
    description: z.string().nullable().optional(),
    meetingUrl: z.string().nullable().optional(),
    attendees: z
      .array(
        z.object({
          email: z.string(),
          name: z.string().optional(),
          status: z.number().optional(),
        }),
      )
      .optional(),
  })
  .passthrough();

export function smarterMailDate(value: z.infer<typeof smarterMailDateSchema>) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:(?:T| )(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,7}))?)?)?([zZ]|[+-]\d{2}:?\d{2})?$/.exec(
      value.date_local,
    );
  if (!match) throw new Error("Invalid SmarterMail event date");
  const [, y, m, d, h = "0", min = "0", sec = "0", fraction = "", offset] =
    match;
  const parts = [+y, +m - 1, +d, +h, +min, +sec];
  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(+y, +m - 1, +d);
  calendarDate.setUTCHours(+h, +min, +sec, 0);
  if (
    calendarDate.getUTCFullYear() !== +y ||
    calendarDate.getUTCMonth() !== +m - 1 ||
    calendarDate.getUTCDate() !== +d ||
    calendarDate.getUTCHours() !== +h ||
    calendarDate.getUTCMinutes() !== +min ||
    calendarDate.getUTCSeconds() !== +sec
  )
    throw new Error("Invalid SmarterMail event date");
  const milliseconds = +`${fraction}000`.slice(0, 3);
  if (offset) {
    const local = `${y}-${m}-${d}T${h.padStart(2, "0")}:${min.padStart(2, "0")}:${sec.padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}${offset}`;
    const result = new Date(local);
    if (!Number.isFinite(result.getTime()))
      throw new Error("Invalid SmarterMail event date");
    return result;
  }
  let timezone = value.time_zone_id;
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    timezone = findIana(timezone)[0] ?? "";
  }
  if (!timezone) throw new Error("Unsupported SmarterMail event timezone");
  const result = new TZDate(
    parts[0],
    parts[1],
    parts[2],
    parts[3],
    parts[4],
    parts[5],
    milliseconds,
    timezone,
  );
  if (
    !Number.isFinite(result.getTime()) ||
    result.getFullYear() !== +y ||
    result.getMonth() !== +m - 1 ||
    result.getDate() !== +d ||
    result.getHours() !== +h ||
    result.getMinutes() !== +min ||
    result.getSeconds() !== +sec
  )
    throw new Error("Invalid SmarterMail event date or nonexistent local time");
  return new Date(result.getTime());
}

export function normalizeSmarterMailCalendarEvent(
  event: z.infer<typeof smarterMailEventSchema>,
  detail?: z.infer<typeof smarterMailEventDetailsSchema>,
): CalendarEvent {
  const startTime = smarterMailDate(event.startWithTZ);
  const endTime = smarterMailDate(event.endWithTZ);
  if (endTime <= startTime)
    throw new Error("Invalid SmarterMail event interval");
  return {
    id: `sm-event:${Buffer.from(JSON.stringify([event.owner, event.calId, event.uid, startTime.toISOString()])).toString("base64url")}`,
    title: event.title,
    startTime,
    endTime,
    location: event.location ?? undefined,
    organizerEmail: event.organizer?.address,
    isOrganizer: event.organizer?.isOrganizer,
    description: detail?.description ?? undefined,
    videoConferenceLink: detail?.meetingUrl ?? undefined,
    attendees:
      detail?.attendees?.map((attendee) => ({
        email: attendee.email,
        name: attendee.name,
      })) ?? [],
  };
}
