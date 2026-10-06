import {
  isGoogleProvider,
  isMicrosoftProvider,
  isSmarterMailProvider,
} from "@/utils/email/provider-types";

export function getMailEngineProvider(provider: string) {
  if (
    isGoogleProvider(provider) ||
    isMicrosoftProvider(provider) ||
    isSmarterMailProvider(provider)
  )
    return provider;
  return null;
}
