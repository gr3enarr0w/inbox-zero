export function isGoogleProvider(
  provider: string | null | undefined,
): provider is "google" {
  return provider === "google";
}

export function isMicrosoftProvider(
  provider: string | null | undefined,
): provider is "microsoft" {
  return provider === "microsoft";
}

export function isSmarterMailProvider(
  provider: string | null | undefined,
): provider is "smartermail" {
  return provider === "smartermail";
}
