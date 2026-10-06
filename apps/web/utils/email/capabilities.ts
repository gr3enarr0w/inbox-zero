import {
  isGoogleProvider,
  isMicrosoftProvider,
  isSmarterMailProvider,
} from "@/utils/email/provider-types";

export function getEmailProviderCapabilities(
  provider: string | null | undefined,
) {
  const google = isGoogleProvider(provider);
  const microsoft = isMicrosoftProvider(provider);
  const smarterMail = isSmarterMailProvider(provider);
  return {
    folders: microsoft || smarterMail,
    labels: google || microsoft || smarterMail,
    categoryEditing: google || microsoft,
    sending: google || microsoft,
    splitInbox: google || microsoft,
  };
}
