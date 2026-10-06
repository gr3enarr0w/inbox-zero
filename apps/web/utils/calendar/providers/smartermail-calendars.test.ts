import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { SmarterMailClient } from "@/utils/smartermail/client";
import { getSmarterMailClientForEmail } from "@/utils/smartermail/account";
import { syncSmarterMailCalendars } from "@/utils/calendar/providers/smartermail-calendars";
import { smarterMailCalendarId } from "@/utils/calendar/providers/smartermail-calendar-id";
vi.mock("server-only", () => ({}));
vi.mock("@/utils/prisma");
vi.mock("@/utils/smartermail/account", () => ({
  getSmarterMailClientForEmail: vi.fn(),
}));
const client = new SmarterMailClient({
  baseUrl: "https://mail.example.com",
  tokens: { accessToken: "fixture", refreshToken: "fixture" },
});
const request = vi.spyOn(client, "request");
const source = {
  owner: "reader",
  id: "primary",
  name: "Personal",
  isPrimary: true,
  isSharedItem: false,
  isCalendar: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSmarterMailClientForEmail).mockResolvedValue(client);
  prisma.emailAccount.findFirst.mockResolvedValue({
    email: "reader@example.com",
  } as never);
  prisma.calendarConnection.upsert.mockResolvedValue({
    id: "connection",
  } as never);
  prisma.calendar.upsert.mockResolvedValue({} as never);
});
describe("SmarterMail calendar connection", () => {
  it("uses account-scoped authentication, retains enabled choices and excludes unrelated sources", async () => {
    request.mockResolvedValueOnce({
      calendars: [
        source,
        { ...source, id: "shared", isSharedItem: true },
        { ...source, id: "task", isTask: true },
        { ...source, owner: "reader@other.example", id: "other" },
      ],
    });
    await syncSmarterMailCalendars({
      emailAccountId: "account",
      userId: "owner",
    });
    expect(getSmarterMailClientForEmail).toHaveBeenCalledWith({
      emailAccountId: "account",
      userId: "owner",
    });
    expect(prisma.calendar.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.calendar.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          connectionId_calendarId: {
            connectionId: "connection",
            calendarId: smarterMailCalendarId("reader", "primary"),
          },
        },
        update: { name: "Personal", primary: true },
      }),
    );
    expect(prisma.calendarConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          isConnected: false,
          emailAccountId: "account",
          provider: "smartermail",
        }),
        update: expect.objectContaining({
          accessToken: null,
          refreshToken: null,
          isConnected: false,
        }),
      }),
    );
    expect(prisma.calendarConnection.update).toHaveBeenLastCalledWith({
      where: { id: "connection" },
      data: { isConnected: true },
    });
  });
  it("keeps failed partial synchronization disconnected", async () => {
    request.mockResolvedValueOnce({ calendars: [source] });
    prisma.calendar.upsert.mockRejectedValueOnce(new Error("storage failed"));
    await expect(
      syncSmarterMailCalendars({ emailAccountId: "account", userId: "owner" }),
    ).rejects.toThrow("storage failed");
    expect(prisma.calendarConnection.update).toHaveBeenLastCalledWith({
      where: { id: "connection" },
      data: { isConnected: false },
    });
  });
});
