import { z } from "zod";

export function smarterMailDraftId(payload: unknown) {
  const result = z
    .object({ mid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) })
    .parse(payload);
  return `sm-draft:${result.mid}`;
}

export function smarterMailDraftMid(id: string) {
  if (
    !/^sm-draft:[1-9]\d*$/.test(id) ||
    !Number.isSafeInteger(Number(id.slice(9)))
  )
    throw new Error("Invalid SmarterMail draft reference");
  return Number(id.slice(9));
}

export function currentDraftUid(
  payload: unknown,
  folder: string,
  expected: { uid?: number; mid?: number } = {},
) {
  return z
    .object({
      messageData: z.object({
        uid:
          expected.uid === undefined
            ? z.number().int().positive()
            : z.literal(expected.uid),
        mid:
          expected.mid === undefined
            ? z.number().int().positive().optional()
            : z.literal(expected.mid),
        folder: z.literal(folder),
        isDraft: z.literal(true),
      }),
    })
    .parse(payload).messageData.uid;
}
