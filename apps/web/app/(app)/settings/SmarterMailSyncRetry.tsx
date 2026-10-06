"use client";

import { useAction } from "next-safe-action/hooks";
import { Button } from "@/components/ui/button";
import { toastError, toastSuccess } from "@/components/Toast";
import { getActionErrorMessage } from "@/utils/error";
import { retrySmarterMailSyncAction } from "@/utils/actions/smartermail-sync";

export function SmarterMailSyncRetry({
  emailAccountId,
  messageId,
  onRetry,
}: {
  emailAccountId: string;
  messageId: string;
  onRetry: () => Promise<unknown>;
}) {
  const { execute, isExecuting } = useAction(
    retrySmarterMailSyncAction.bind(null, emailAccountId),
    {
      onSuccess: async () => {
        await onRetry();
        toastSuccess({
          description: "Message processing will be retried on the next sync.",
        });
      },
      onError: ({ error }) =>
        toastError({ description: getActionErrorMessage(error) }),
    },
  );
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => execute({ messageId })}
      loading={isExecuting}
    >
      Retry processing
    </Button>
  );
}
