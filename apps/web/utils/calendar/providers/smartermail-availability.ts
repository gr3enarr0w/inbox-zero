import prisma from "@/utils/prisma";
import { SafeError } from "@/utils/error";
import type { CalendarAvailabilityProvider } from "@/utils/calendar/availability-types";
import { getSmarterMailClientForEmail } from "@/utils/smartermail/account";
import { fetchSmarterMailCalendarEvents } from "@/utils/calendar/providers/smartermail-event-read";
import { normalizeSmarterMailCalendarEvent } from "@/utils/calendar/providers/smartermail-event-normalization";

export function createSmarterMailAvailabilityProvider(): CalendarAvailabilityProvider {
  return {
    name: "smartermail",
    async fetchBusyPeriods({ emailAccountId, calendarIds, timeMin, timeMax }) {
      const client = await getSmarterMailClientForEmail({ emailAccountId });
      const account = await prisma.emailAccount.findUnique({
        where: { id: emailAccountId },
        select: { email: true },
      });
      if (!account) throw new SafeError("Email account unavailable");
      const events = await fetchSmarterMailCalendarEvents(
        client,
        calendarIds,
        new Date(timeMin),
        new Date(timeMax),
        account.email,
      );
      // The list API omits free/busy status; treating all events as busy avoids false availability.
      return events.map((event) => {
        const { startTime, endTime } = normalizeSmarterMailCalendarEvent(event);
        return { start: startTime.toISOString(), end: endTime.toISOString() };
      });
    },
  };
}
