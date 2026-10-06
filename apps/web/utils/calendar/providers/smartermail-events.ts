import type {
  CalendarInvitation,
  InvitationResponse,
} from "@/utils/calendar/invitations/parser";
import prisma from "@/utils/prisma";
import { SafeError } from "@/utils/error";
import type { Logger } from "@/utils/logger";
import type {
  CalendarEventProvider,
  CalendarEventWriteInput,
  CalendarEventCancelInput,
  CalendarEventUpdateInput,
} from "@/utils/calendar/event-types";
import { getSmarterMailClientForEmail } from "@/utils/smartermail/account";
import { fetchSmarterMailCalendarEvents } from "@/utils/calendar/providers/smartermail-event-read";
import { hydrateSmarterMailCalendarEvents } from "@/utils/calendar/providers/smartermail-event-detail";

type Connection = { emailAccountId: string; connectionId: string };
export class SmarterMailCalendarEventProvider implements CalendarEventProvider {
  private readonly connection: Connection;
  constructor(connection: Connection, _logger: Logger) {
    this.connection = connection;
  }

  async fetchEvents({
    timeMin = new Date(),
    timeMax = new Date(timeMin.getTime() + 30 * 86_400_000),
    maxResults = 10,
  }: {
    timeMin?: Date;
    timeMax?: Date;
    maxResults?: number;
  }) {
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 25)
      throw new SafeError(
        "SmarterMail event detail queries support at most 25 results",
      );
    const { client, events } = await this.events(timeMin, timeMax);
    return hydrateSmarterMailCalendarEvents(
      client,
      events.slice(0, maxResults),
    );
  }

  async fetchEventsWithAttendee({
    attendeeEmail,
    timeMin,
    timeMax,
    maxResults,
  }: {
    attendeeEmail: string;
    timeMin: Date;
    timeMax: Date;
    maxResults: number;
  }) {
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 25)
      throw new SafeError(
        "SmarterMail event detail queries support at most 25 results",
      );
    const { client, events } = await this.events(timeMin, timeMax);
    if (events.length > 25)
      throw new SafeError(
        "SmarterMail attendee lookup exceeds the bounded detail query; use a smaller date window",
      );
    const hydrated = await hydrateSmarterMailCalendarEvents(client, events);
    return hydrated
      .filter((event) =>
        event.attendees.some(
          (attendee) =>
            attendee.email.toLowerCase() === attendeeEmail.toLowerCase(),
        ),
      )
      .slice(0, maxResults);
  }

  async createEvent(_input: CalendarEventWriteInput): Promise<never> {
    throw unsupportedWrite();
  }
  async cancelEvent(_input: CalendarEventCancelInput): Promise<never> {
    throw unsupportedWrite();
  }
  async updateEvent(_input: CalendarEventUpdateInput): Promise<never> {
    throw unsupportedWrite();
  }
  async findInvitationEvent(
    _invitation: CalendarInvitation,
    _calendarEventId?: string,
  ): Promise<never> {
    throw unsupportedWrite();
  }
  async respondToInvitation(
    _eventId: string,
    _invitation: CalendarInvitation,
    _response: InvitationResponse,
  ): Promise<never> {
    throw unsupportedWrite();
  }

  private async events(timeMin: Date, timeMax: Date) {
    const calendars = await prisma.calendar.findMany({
      where: {
        isEnabled: true,
        connection: {
          id: this.connection.connectionId,
          emailAccountId: this.connection.emailAccountId,
          provider: "smartermail",
          isConnected: true,
        },
      },
      select: { calendarId: true },
    });
    const client = await getSmarterMailClientForEmail({
      emailAccountId: this.connection.emailAccountId,
    });
    const account = await prisma.emailAccount.findUnique({
      where: { id: this.connection.emailAccountId },
      select: { email: true },
    });
    if (!account) throw new SafeError("Email account unavailable");
    const events = await fetchSmarterMailCalendarEvents(
      client,
      calendars.map((calendar) => calendar.calendarId),
      timeMin,
      timeMax,
      account.email,
    );
    return { client, events };
  }
}

function unsupportedWrite() {
  return new SafeError(
    "SmarterMail calendars support event reading and availability; booking and invitation writes are not supported yet",
  );
}
