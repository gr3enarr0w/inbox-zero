import { z } from "zod";

export function smarterMailCalendarId(owner: string, id: string) {
  return `sm-cal:${Buffer.from(JSON.stringify([owner, id])).toString("base64url")}`;
}

export function parseSmarterMailCalendarId(value: string) {
  if (!value.startsWith("sm-cal:"))
    throw new Error("Invalid SmarterMail calendar");
  const [owner, id] = z
    .tuple([z.string().min(1), z.string().min(1)])
    .parse(
      JSON.parse(Buffer.from(value.slice(7), "base64url").toString("utf8")),
    );
  if (smarterMailCalendarId(owner, id) !== value)
    throw new Error("Invalid SmarterMail calendar");
  return { owner, id };
}
