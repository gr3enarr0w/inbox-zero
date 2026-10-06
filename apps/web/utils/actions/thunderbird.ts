"use server";

import { actionClientUser } from "@/utils/actions/safe-action";
import { connectThunderbird } from "@/utils/thunderbird/connect";
import { clearAccountDisconnectedErrorIfResolved } from "@/utils/error-messages";

export const connectThunderbirdAction = actionClientUser
  .metadata({ name: "connectThunderbird" })
  .action(async ({ ctx: { userId, logger } }) => {
    const result = await connectThunderbird(userId);
    await clearAccountDisconnectedErrorIfResolved({ userId, logger });
    return result;
  });
