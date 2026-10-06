import { vi } from "vitest";
import { SmarterMailClient } from "./client";

export function tokens(accessToken = "access", refreshToken = "refresh") {
  return { accessToken, refreshToken };
}

export function authenticatedClient() {
  return new SmarterMailClient({
    baseUrl: "https://mail.example.com",
    tokens: tokens(),
  });
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function mockFetch(...responses: Response[]) {
  const mock =
    vi.fn<
      (
        url: string,
        init: { headers: Record<string, string>; redirect: string },
      ) => Promise<Response>
    >();
  for (const response of responses) mock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", mock);
  return mock;
}
