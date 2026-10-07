"use client";

import { useEffect, useRef } from "react";
import { useAccount } from "@/providers/EmailAccountProvider";
import { useStatLoader } from "@/providers/StatLoaderProvider";
import { ActionCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function EmailStatsPreloader({
  loadBefore = false,
}: {
  loadBefore?: boolean;
}) {
  const { emailAccountId } = useAccount();
  const { onLoadBatch, isLoading, error, progress } = useStatLoader();
  const lastPreloadedAccountId = useRef<string | null>(null);
  useEffect(() => {
    if (lastPreloadedAccountId.current === emailAccountId) return;
    lastPreloadedAccountId.current = emailAccountId;
    onLoadBatch({ loadBefore, showToast: false });
  }, [emailAccountId, loadBefore, onLoadBatch]);
  if (!isLoading && !error && progress?.complete) return null;
  return (
    <ActionCard
      role={error ? "alert" : "status"}
      variant={error ? "destructive" : "blue"}
      title={
        error
          ? "Email import failed"
          : isLoading
            ? "Importing emails"
            : "Email import is incomplete"
      }
      description={
        error ??
        `${progress?.imported ?? 0} messages imported so far. Counts and cleanup results may still be incomplete.`
      }
      action={
        !isLoading && (
          <Button
            variant="outline"
            onClick={() => onLoadBatch({ loadBefore, showToast: false })}
          >
            {error ? "Retry import" : "Continue import"}
          </Button>
        )
      }
    />
  );
}
