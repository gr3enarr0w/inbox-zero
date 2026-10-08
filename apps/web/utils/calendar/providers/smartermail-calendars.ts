import { z } from "zod";
import prisma from "@/utils/prisma";
import { SafeError } from "@/utils/error";
import { getSmarterMailClientForEmail } from "@/utils/smartermail/account";
import type { SmarterMailClient } from "@/utils/smartermail/client";
import { smarterMailCalendarId } from "@/utils/calendar/providers/smartermail-calendar-id";

const sourceSchema = z.object({
  id: z.string().min(1),
  owner: z.string().min(1),
  name: z.string(),
  isPrimary: z.boolean(),
  isSharedItem: z.boolean(),
  isCalendar: z.boolean(),
  isTask: z.boolean().optional(),
  isDomainResource: z.boolean().optional(),
  isWebCalendar: z.boolean().optional(),
});

export async function getSmarterMailCalendarSources(
  client: SmarterMailClient,
  ownerEmail: string,
) {
  const { calendars } = z
    .object({ calendars: z.array(sourceSchema).max(50) })
    .parse(await client.request("calendarSources"));
  return calendars.filter(
    (source) =>
      (source.owner.toLowerCase() === ownerEmail.toLowerCase() ||
        source.owner.toLowerCase() ===
          ownerEmail.split("@")[0].toLowerCase()) &&
      source.isCalendar &&
      !source.isSharedItem &&
      !source.isTask &&
      !source.isDomainResource &&
      !source.isWebCalendar,
  );
}

export async function syncSmarterMailCalendars({
  emailAccountId,
  userId,
}: {
  emailAccountId: string;
  userId?: string;
}) {
  const client = await getSmarterMailClientForEmail({ emailAccountId, userId });
  const account = await prisma.emailAccount.findFirst({
    where: { id: emailAccountId, ...(userId ? { userId } : {}) },
    select: { email: true },
  });
  if (!account) throw new SafeError("Email account not found");
  const sources = await getSmarterMailCalendarSources(client, account.email);
  if (!sources.length)
    throw new SafeError("No personal SmarterMail calendars found");
  const connection = await prisma.calendarConnection.upsert({
    where: {
      emailAccountId_provider_email: {
        emailAccountId,
        provider: "smartermail",
        email: account.email,
      },
    },
    create: {
      emailAccountId,
      provider: "smartermail",
      email: account.email,
      isConnected: false,
    },
    update: {
      isConnected: false,
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
    },
  });
  try {
    for (const source of sources) {
      const calendarId = smarterMailCalendarId(source.owner, source.id);
      await prisma.calendar.upsert({
        where: {
          connectionId_calendarId: { connectionId: connection.id, calendarId },
        },
        create: {
          connectionId: connection.id,
          calendarId,
          name: source.name,
          primary: source.isPrimary,
        },
        update: { name: source.name, primary: source.isPrimary },
      });
    }
    await prisma.calendar.deleteMany({
      where: {
        connectionId: connection.id,
        calendarId: {
          notIn: sources.map((source) =>
            smarterMailCalendarId(source.owner, source.id),
          ),
        },
      },
    });
    await prisma.calendarConnection.update({
      where: { id: connection.id },
      data: { isConnected: true },
    });
    return { success: true };
  } catch (error) {
    await prisma.calendarConnection.update({
      where: { id: connection.id },
      data: { isConnected: false },
    });
    throw error;
  }
}
