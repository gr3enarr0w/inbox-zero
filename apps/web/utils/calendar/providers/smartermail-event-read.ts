import { z } from "zod";
import { SafeError } from "@/utils/error";
import type { SmarterMailClient } from "@/utils/smartermail/client";
import {
  normalizeSmarterMailCalendarEvent,
  smarterMailEventSchema,
} from "@/utils/calendar/providers/smartermail-event-normalization";
import { getSmarterMailCalendarSources } from "@/utils/calendar/providers/smartermail-calendars";
import {
  smarterMailCalendarId,
  parseSmarterMailCalendarId,
} from "@/utils/calendar/providers/smartermail-calendar-id";
export async function fetchSmarterMailCalendarEvents(
  client: SmarterMailClient,
  calendarIds: string[],
  timeMin: Date,
  timeMax: Date,
  ownerEmail: string,
) {
  if (
    !Number.isFinite(timeMin.getTime()) ||
    !Number.isFinite(timeMax.getTime()) ||
    timeMax <= timeMin ||
    timeMax.getTime() - timeMin.getTime() > 93 * 86_400_000
  )
    throw new SafeError(
      "SmarterMail calendar queries require a valid window of at most 93 days",
    );
  if (calendarIds.length > 50)
    throw new SafeError("Too many SmarterMail calendars");
  const sources = await getSmarterMailCalendarSources(client, ownerEmail);
  const allowed = new Set(
    sources.map((source) => smarterMailCalendarId(source.owner, source.id)),
  );
  const events: Array<{
    event: z.infer<typeof smarterMailEventSchema>;
    startTime: number;
  }> = [];
  for (const calendarId of new Set(calendarIds)) {
    if (!allowed.has(calendarId))
      throw new SafeError("SmarterMail calendar unavailable");
    const { owner, id } = parseSmarterMailCalendarId(calendarId);
    const result = z
      .object({ events: z.array(smarterMailEventSchema).max(5000) })
      .parse(
        await client.request(
          "calendarEvents",
          { startDate: timeMin.toISOString(), endDate: timeMax.toISOString() },
          { owner, id },
        ),
      );
    for (const event of result.events) {
      if (event.owner !== owner || event.calId !== id)
        throw new SafeError("SmarterMail event scope mismatch");
      if (event.status === 2 || event.isTask) continue;
      const normalized = normalizeSmarterMailCalendarEvent(event);
      if (normalized.endTime > timeMin && normalized.startTime < timeMax) {
        events.push({ event, startTime: normalized.startTime.getTime() });
        if (events.length > 5000)
          throw new SafeError(
            "SmarterMail calendar query exceeds 5000 events; use a smaller date window",
          );
      }
    }
  }
  return events
    .sort((a, b) => a.startTime - b.startTime)
    .map(({ event }) => event);
}
