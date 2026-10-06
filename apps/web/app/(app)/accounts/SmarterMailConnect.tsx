"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { useSWRConfig } from "swr";
import { Input } from "@/components/Input";
import { Button } from "@/components/ui/button";
import { toastError, toastSuccess } from "@/components/Toast";
import { connectSmarterMailAction } from "@/utils/actions/smartermail";
import {
  connectSmarterMailBody,
  type ConnectSmarterMailBody,
} from "@/utils/actions/smartermail.validation";
import { getActionErrorMessage } from "@/utils/error";

export function SmarterMailConnect() {
  const [expanded, setExpanded] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const { mutate } = useSWRConfig();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ConnectSmarterMailBody>({
    resolver: zodResolver(connectSmarterMailBody),
  });
  const { execute, isExecuting } = useAction(connectSmarterMailAction, {
    onSuccess: async ({ data }) => {
      if (data?.mfaRequired) {
        setMfaRequired(true);
        return;
      }
      reset();
      setMfaRequired(false);
      setExpanded(false);
      await mutate("/api/user/email-accounts");
      toastSuccess({ description: "SmarterMail account connected." });
      window.location.assign("/accounts");
    },
    onError: ({ error }) =>
      toastError({ description: getActionErrorMessage(error) }),
  });
  return (
    <div className="w-full max-w-md">
      <Button
        variant="outline"
        className="w-full"
        onClick={() => {
          reset();
          setMfaRequired(false);
          setExpanded(!expanded);
        }}
        disabled={isExecuting}
      >
        {expanded ? "Cancel SmarterMail connection" : "Add SmarterMail"}
      </Button>
      {expanded && (
        <form onSubmit={handleSubmit(execute)} className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Your administrator must enable this server before you can connect.
            Your password is used to sign in and is never stored.
          </p>
          <Input
            name="baseUrl"
            type="url"
            label="SmarterMail server"
            placeholder="https://mail.example.com"
            registerProps={register("baseUrl")}
            error={errors.baseUrl}
            disabled={isExecuting}
          />
          <Input
            name="username"
            type="email"
            label="Mailbox email"
            registerProps={register("username", {
              onChange: () => setMfaRequired(false),
            })}
            error={errors.username}
            disabled={isExecuting}
          />
          <Input
            name="password"
            type="password"
            label="Mailbox password"
            registerProps={{
              ...register("password"),
              autoComplete: "current-password",
            }}
            error={errors.password}
            disabled={isExecuting}
          />
          {mfaRequired && (
            <Input
              name="twoFactorCode"
              type="text"
              label="Authentication code"
              registerProps={{
                ...register("twoFactorCode"),
                autoComplete: "one-time-code",
              }}
              error={errors.twoFactorCode}
              disabled={isExecuting}
            />
          )}
          <Button type="submit" loading={isExecuting}>
            {mfaRequired ? "Verify and connect" : "Connect SmarterMail"}
          </Button>
        </form>
      )}
    </div>
  );
}
