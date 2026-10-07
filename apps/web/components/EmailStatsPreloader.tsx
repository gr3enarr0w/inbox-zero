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
  const retained = progress?.retained ?? 0;
  if (!isLoading && !error && progress?.complete && !retained) return null;
  let title = "Email import is incomplete";
  let description = `${progress?.imported ?? 0} messages imported so far. Counts and cleanup results may still be incomplete.`;
  if (progress?.retained !== undefined) {
    description = `${progress.imported} current messages cached. ${retained} historical records retained and excluded from current counts and cleanup.`;
    if (!progress.complete) description += " Import is still incomplete.";
    else title = "Historical metadata retained";
  }
  if (isLoading) title = "Importing emails";
  if (error) {
    title = "Email import failed";
    description = error;
  }
  return (
    <ActionCard
      role={error ? "alert" : "status"}
      variant={error ? "destructive" : "blue"}
      title={title}
      description={description}
      action={
        !isLoading &&
        (error || !progress?.complete) && (
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
