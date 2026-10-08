import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authenticatedClient,
  jsonResponse,
  mockFetch,
} from "./client.test-support";

afterEach(() => vi.unstubAllGlobals());

describe("SmarterMail calendar operation paths", () => {
  it("encodes calendar identifiers without allowing query injection", async () => {
    const fetchMock = mockFetch(jsonResponse({ success: true, events: [] }));
    await authenticatedClient().request(
      "calendarEvents",
      {},
      {
        owner: "user@example.com",
        id: "calendar?other=1#section",
      },
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://mail.example.com/api/v1/calendars/events/user%40example.com/calendar%3Fother%3D1%23section",
    );
  });

  it.each([
    "",
    ".",
    "..",
    "../other",
    "folder/other",
    "folder\\other",
    "\n",
  ])("rejects unsafe path segment %j before contacting the server", async (id) => {
    const fetchMock = mockFetch();
    await expect(
      authenticatedClient().request(
        "calendarEvents",
        {},
        {
          owner: "user@example.com",
          id,
        },
      ),
    ).rejects.toThrow("path parameters");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects missing and unexpected path parameters", async () => {
    const fetchMock = mockFetch();
    const client = authenticatedClient();
    await expect(client.request("calendarEvents", {})).rejects.toThrow(
      "path parameters",
    );
    await expect(
      client.request("calendarSources", undefined, {
        owner: "user@example.com",
      }),
    ).rejects.toThrow("path parameters");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
