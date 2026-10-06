"use server";

import { actionClient } from "@/utils/actions/safe-action";
import { retrySmarterMailSyncBody } from "@/utils/actions/smartermail-sync.validation";
import { retrySmarterMailSyncMessage } from "@/utils/smartermail/retry-sync";
import { SafeError } from "@/utils/error";

export const retrySmarterMailSyncAction = actionClient
  .metadata({ name: "retrySmarterMailSync" })
  .inputSchema(retrySmarterMailSyncBody)
  .action(async ({ ctx: { emailAccountId, provider }, parsedInput }) => {
    if (provider !== "smartermail")
      throw new SafeError("SmarterMail account required");
    return retrySmarterMailSyncMessage(emailAccountId, parsedInput.messageId);
  });
