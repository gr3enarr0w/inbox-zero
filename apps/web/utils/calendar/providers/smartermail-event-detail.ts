import { z } from "zod";
import { SafeError } from "@/utils/error";
import type { SmarterMailClient } from "@/utils/smartermail/client";
import {
  normalizeSmarterMailCalendarEvent,
  type smarterMailEventSchema,
  smarterMailEventDetailsSchema,
} from "@/utils/calendar/providers/smartermail-event-normalization";
export async function hydrateSmarterMailCalendarEvents(
  client: SmarterMailClient,
  events: Array<z.infer<typeof smarterMailEventSchema>>,
) {
  const details = new Map<
    string,
    z.infer<typeof smarterMailEventDetailsSchema>
  >();
  const result = [];
  for (const event of events) {
    const key = JSON.stringify([event.owner, event.calId, event.id]);
    let detail = details.get(key);
    if (!detail) {
      detail = z.object({ details: smarterMailEventDetailsSchema }).parse(
        await client.request("calendarEvent", undefined, {
          owner: event.owner,
          calId: event.calId,
          eventId: String(event.id),
        }),
      ).details;
      details.set(key, detail);
    }
    if (
      (detail.id !== 0 && detail.id !== event.id) ||
      detail.uid !== event.uid ||
      detail.calendarOwner !== event.owner ||
      detail.calendarId !== event.calId
    )
      throw new SafeError("SmarterMail event detail scope mismatch");
    result.push(normalizeSmarterMailCalendarEvent(event, detail));
  }
  return result;
}
