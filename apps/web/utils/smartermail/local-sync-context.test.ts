import { describe, expect, it } from "vitest";
import {
  getSmarterMailLocalSyncContext,
  withSmarterMailLocalSyncContext,
} from "./local-sync-context";

describe("SmarterMail local sync context", () => {
  it("keeps concurrent accounts separate and clears scope after completion", async () => {
    const contexts = await Promise.all(
      ["first", "second"].map((emailAccountId) =>
        withSmarterMailLocalSyncContext(
          emailAccountId,
          "backfill",
          async () => {
            await Promise.resolve();
            return getSmarterMailLocalSyncContext();
          },
        ),
      ),
    );
    expect(contexts.map((value) => value?.emailAccountId)).toEqual([
      "first",
      "second",
    ]);
    expect(
      contexts.every(
        (value) =>
          value?.priority === "backfill" && value.signal instanceof AbortSignal,
      ),
    ).toBe(true);
    expect(getSmarterMailLocalSyncContext()).toBeUndefined();
  });
});
