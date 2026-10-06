import {
  isGoogleProvider,
  isMicrosoftProvider,
  isSmarterMailProvider,
  isThunderbirdProvider,
} from "@/utils/email/provider-types";

export function getEmailProviderCapabilities(
  provider: string | null | undefined,
) {
  const google = isGoogleProvider(provider);
  const microsoft = isMicrosoftProvider(provider);
  const smarterMail = isSmarterMailProvider(provider);
  const thunderbird = isThunderbirdProvider(provider);
  return {
    folders: microsoft || smarterMail || thunderbird,
    labels: google || microsoft || smarterMail || thunderbird,
    categoryEditing: google || microsoft,
    sending: google || microsoft,
    splitInbox: google || microsoft,
  };
}
