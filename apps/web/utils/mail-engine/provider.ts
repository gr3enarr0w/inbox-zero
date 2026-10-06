import {
  isGoogleProvider,
  isMicrosoftProvider,
  isSmarterMailProvider,
  isThunderbirdProvider,
} from "@/utils/email/provider-types";

export function getMailEngineProvider(provider: string) {
  if (
    isGoogleProvider(provider) ||
    isMicrosoftProvider(provider) ||
    isSmarterMailProvider(provider) ||
    isThunderbirdProvider(provider)
  )
    return provider;
  return null;
}
