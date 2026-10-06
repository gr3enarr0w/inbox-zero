"use client";

import Link from "next/link";
import useSWR from "swr";
import type { SmarterMailSyncStatusResponse } from "@/app/api/user/smartermail-sync-status/route";
import { LoadingContent } from "@/components/LoadingContent";
import { Item, ItemContent, ItemTitle } from "@/components/ui/item";
import { Button } from "@/components/ui/button";
import { getAccountScopedKey } from "@/utils/swr";
import { SmarterMailSyncRetry } from "@/app/(app)/settings/SmarterMailSyncRetry";

export function SmarterMailSyncStatus({
  emailAccountId,
}: {
  emailAccountId: string;
}) {
  const { data, isLoading, error, mutate, isValidating } =
    useSWR<SmarterMailSyncStatusResponse>(
      getAccountScopedKey("/api/user/smartermail-sync-status", emailAccountId),
      { refreshInterval: 30_000 },
    );
  const needingReview =
    data?.reviewRequired.filter(
      (message) => message.status === "review_required",
    ) ?? [];
  const pending =
    data?.reviewRequired.filter((message) => message.status === "claimed") ??
    [];
  const retryable =
    data?.reviewRequired.filter(
      (message) => message.status === "retry_ready",
    ) ?? [];
  return (
    <Item size="sm">
      <ItemContent className="space-y-3">
        <ItemTitle>SmarterMail syncing</ItemTitle>
        <LoadingContent loading={isLoading} error={error}>
          {data && (
            <div className="space-y-3 text-sm">
              {!data.state ? (
                <p className="text-muted-foreground">
                  Waiting for the first scheduled sync.
                </p>
              ) : (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <dt>Status</dt>
                  <dd>{data.state.enabled ? "Enabled" : "Paused"}</dd>
                  <dt>Last successful sync</dt>
                  <dd>
                    {formatSyncTime(data.state.lastSyncedAt, "Not synced yet")}
                  </dd>
                  <dt>Next attempt</dt>
                  <dd>
                    {data.state.enabled
                      ? formatSyncTime(data.state.nextRunAt, "Not scheduled")
                      : "Paused"}
                  </dd>
                  <dt>Consecutive failures</dt>
                  <dd>{data.state.failures}</dd>
                </dl>
              )}
              {data.state && !data.state.enabled && (
                <p>Reconnect this mailbox from Accounts to restore syncing.</p>
              )}
              {needingReview.length > 0 && (
                <p role="status">
                  {needingReview.length} message
                  {needingReview.length === 1 ? " needs" : "s need"} review.
                  Check your inbox and automation history before retrying any
                  actions.
                </p>
              )}
              {pending.length > 0 && (
                <p className="text-muted-foreground">
                  {pending.length} message
                  {pending.length === 1 ? " is" : "s are"} awaiting processing
                  confirmation. If this persists, check your inbox and
                  automation history.
                </p>
              )}
              {retryable.map((message) => (
                <div
                  key={message.messageId}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <p>
                    Processing failed before actions ran (
                    {formatSyncTime(message.createdAt, "time unavailable")}).
                  </p>
                  <SmarterMailSyncRetry
                    emailAccountId={emailAccountId}
                    messageId={message.messageId}
                    onRetry={() => mutate()}
                  />
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => mutate()}
                  disabled={isValidating}
                >
                  Refresh status
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/${emailAccountId}/mail`}>Open inbox</Link>
                </Button>
                {data.state && !data.state.enabled && (
                  <Button asChild size="sm" variant="outline">
                    <Link href="/accounts">Reconnect mailbox</Link>
                  </Button>
                )}
              </div>
            </div>
          )}
        </LoadingContent>
      </ItemContent>
    </Item>
  );
}

function formatSyncTime(value: Date | null, fallback: string) {
  if (!value) return fallback;
  return new Date(value.toString()).toLocaleString();
}
