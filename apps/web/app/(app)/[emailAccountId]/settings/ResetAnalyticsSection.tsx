"use client";

import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/providers/EmailAccountProvider";
import { getActionErrorMessage } from "@/utils/error";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
  ItemSeparator,
} from "@/components/ui/item";
import { resetAnalyticsAction } from "@/utils/actions/user";

export function ResetAnalyticsSection({
  emailAccountId,
}: {
  emailAccountId: string;
}) {
  const { provider, isLoading } = useAccount();
  const refresh = provider === "smartermail";
  const { executeAsync, isExecuting } = useAction(
    resetAnalyticsAction.bind(null, emailAccountId),
  );
  function execute(confirmDelete: boolean) {
    toast.promise(
      async () => {
        const response = await executeAsync({ confirmDelete });
        if (
          !response?.data ||
          response.serverError ||
          response.validationErrors
        )
          throw new Error(getActionErrorMessage(response));
        return response.data;
      },
      {
        loading: refresh
          ? "Scheduling analytics refresh..."
          : "Resetting analytics...",
        success: (data) =>
          data.mode === "refresh"
            ? "Analytics refresh scheduled. Imported history is preserved."
            : "Cached analytics deleted. Visit Analytics or Unsubscriber to import again.",
        error: (error: unknown) =>
          error instanceof Error ? error.message : "Analytics update failed.",
      },
    );
  }
  return (
    <>
      <ItemSeparator />
      <Item size="sm">
        <ItemContent>
          <ItemTitle>
            {refresh ? "Refresh analytics" : "Reset Analytics"}
          </ItemTitle>
          <ItemDescription>
            {refresh
              ? "Refresh current mailbox counts while preserving imported history."
              : "Permanently delete cached analytics. Email messages in your mailbox are preserved."}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          {refresh ? (
            <Button
              size="sm"
              variant="outline"
              disabled={isLoading || isExecuting}
              onClick={() => execute(false)}
            >
              Refresh
            </Button>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isLoading || isExecuting}
                >
                  Reset
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete cached analytics?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes imported analytics for this
                    account. Your mailbox messages and assistant classification
                    history are preserved. Counts will need to be imported
                    again.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => execute(true)}>
                    Delete cached analytics
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </ItemActions>
      </Item>
    </>
  );
}
