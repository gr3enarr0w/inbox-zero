"use client";

import useSWR, { useSWRConfig } from "swr";
import { useAction } from "next-safe-action/hooks";
import { Button } from "@/components/ui/button";
import { toastError, toastSuccess } from "@/components/Toast";
import { connectThunderbirdAction } from "@/utils/actions/thunderbird";
import { getActionErrorMessage } from "@/utils/error";

export function ThunderbirdConnect() {
  const { data } = useSWR<{ enabled: boolean }>(
    "/api/user/thunderbird-connection",
  );
  const { mutate } = useSWRConfig();
  const { execute, isExecuting } = useAction(connectThunderbirdAction, {
    onSuccess: async () => {
      await mutate("/api/user/email-accounts");
      toastSuccess({ description: "Thunderbird mailbox connected." });
      window.location.assign("/accounts");
    },
    onError: ({ error }) =>
      toastError({ description: getActionErrorMessage(error) }),
  });
  if (!data?.enabled) return null;
  return (
    <Button variant="outline" loading={isExecuting} onClick={() => execute()}>
      Connect Thunderbird
    </Button>
  );
}
