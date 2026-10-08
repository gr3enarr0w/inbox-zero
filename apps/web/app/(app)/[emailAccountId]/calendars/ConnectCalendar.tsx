"use client";

import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/providers/EmailAccountProvider";
import { toastError } from "@/components/Toast";
import { captureException, getActionErrorMessage } from "@/utils/error";
import { connectSmarterMailCalendarAction } from "@/utils/actions/calendar";
import { useCalendars } from "@/hooks/useCalendars";
import type { GetCalendarAuthUrlResponse } from "@/app/api/google/calendar/auth-url/route";
import { fetchWithAccount } from "@/utils/fetch";
import { CALENDAR_ONBOARDING_RETURN_COOKIE } from "@/utils/calendar/constants";
import { useProductAnalytics } from "@/hooks/useProductAnalytics";
import type { AppPage } from "@/utils/analytics/product";
import { redirectToSafeUrl } from "@/utils/redirect";

export function ConnectCalendar({
  analyticsPage,
  onboardingReturnPath,
}: {
  analyticsPage?: AppPage;
  onboardingReturnPath?: string;
}) {
  const { emailAccountId, provider } = useAccount();
  const { mutate } = useCalendars();
  const analytics = useProductAnalytics(analyticsPage);
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
  const [isConnectingMicrosoft, setIsConnectingMicrosoft] = useState(false);

  const { execute: connectSmarterMail, isExecuting: isConnectingSmarterMail } =
    useAction(connectSmarterMailCalendarAction.bind(null, emailAccountId), {
      onSuccess: async () => {
        await mutate();
        if (onboardingReturnPath) redirectToSafeUrl(onboardingReturnPath);
      },
      onError: ({ error }) => {
        analytics.captureAction("calendar_connect_start_failed", {
          provider: "smartermail",
        });
        toastError({ description: getActionErrorMessage(error) });
      },
    });
  const isConnecting =
    isConnectingGoogle || isConnectingMicrosoft || isConnectingSmarterMail;

  const setOnboardingReturnCookie = () => {
    if (onboardingReturnPath) {
      document.cookie = `${CALENDAR_ONBOARDING_RETURN_COOKIE}=${encodeURIComponent(onboardingReturnPath)}; path=/; max-age=180; SameSite=Lax; Secure`;
    }
  };

  const handleConnectGoogle = async () => {
    analytics.captureAction("calendar_connect_started", {
      provider: "google",
      has_onboarding_return_path: Boolean(onboardingReturnPath),
    });
    setIsConnectingGoogle(true);
    try {
      const response = await fetchWithAccount({
        url: "/api/google/calendar/auth-url",
        emailAccountId,
        init: { headers: { "Content-Type": "application/json" } },
      });

      if (!response.ok) {
        throw new Error("Failed to initiate Google calendar connection");
      }

      const data: GetCalendarAuthUrlResponse = await response.json();
      setOnboardingReturnCookie();
      redirectToSafeUrl(data.url, { allowExternal: true });
    } catch (error) {
      analytics.captureAction("calendar_connect_start_failed", {
        provider: "google",
      });
      captureException(error, {
        extra: { context: "Google Calendar OAuth initiation" },
      });
      toastError({
        title: "Error initiating Google calendar connection",
        description: "Please try again or contact support",
      });
      setIsConnectingGoogle(false);
    }
  };

  const handleConnectMicrosoft = async () => {
    analytics.captureAction("calendar_connect_started", {
      provider: "microsoft",
      has_onboarding_return_path: Boolean(onboardingReturnPath),
    });
    setIsConnectingMicrosoft(true);
    try {
      const response = await fetchWithAccount({
        url: "/api/outlook/calendar/auth-url",
        emailAccountId,
        init: { headers: { "Content-Type": "application/json" } },
      });

      if (!response.ok) {
        throw new Error("Failed to initiate Microsoft calendar connection");
      }

      const data: GetCalendarAuthUrlResponse = await response.json();
      setOnboardingReturnCookie();
      redirectToSafeUrl(data.url, { allowExternal: true });
    } catch (error) {
      analytics.captureAction("calendar_connect_start_failed", {
        provider: "microsoft",
      });
      captureException(error, {
        extra: { context: "Microsoft Calendar OAuth initiation" },
      });
      toastError({
        title: "Error initiating Microsoft calendar connection",
        description: "Please try again or contact support",
      });
      setIsConnectingMicrosoft(false);
    }
  };

  return (
    <div className="flex gap-2 flex-wrap md:flex-nowrap">
      {provider === "smartermail" && (
        <Button
          onClick={() => {
            analytics.captureAction("calendar_connect_started", {
              provider: "smartermail",
              has_onboarding_return_path: Boolean(onboardingReturnPath),
            });
            connectSmarterMail();
          }}
          disabled={isConnecting}
          variant="outline"
          className="flex items-center gap-2 w-full md:w-auto"
        >
          <CalendarIcon className="size-4" />
          {isConnectingSmarterMail
            ? "Connecting..."
            : "Add SmarterMail Calendar"}
        </Button>
      )}

      <Button
        onClick={handleConnectGoogle}
        disabled={isConnecting}
        variant="outline"
        className="flex items-center gap-2 w-full md:w-auto"
      >
        <Image
          src="/images/google.svg"
          alt="Google"
          width={16}
          height={16}
          unoptimized
        />
        {isConnectingGoogle ? "Connecting..." : "Add Google Calendar"}
      </Button>

      <Button
        onClick={handleConnectMicrosoft}
        disabled={isConnecting}
        variant="outline"
        className="flex items-center gap-2 w-full md:w-auto"
      >
        <Image
          src="/images/microsoft.svg"
          alt="Microsoft"
          width={16}
          height={16}
          unoptimized
        />
        {isConnectingMicrosoft ? "Connecting..." : "Add Outlook Calendar"}
      </Button>
    </div>
  );
}
