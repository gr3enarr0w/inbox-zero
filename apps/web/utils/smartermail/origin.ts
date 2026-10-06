import { SafeError } from "@/utils/error";

export function validateSmarterMailOrigin(
  input: string,
  allowedOrigins: string | undefined,
) {
  const origin = parseOrigin(input);
  const allowed = (allowedOrigins ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!allowed.some((value) => parseOrigin(value) === origin)) {
    throw new SafeError(
      "This SmarterMail server has not been enabled by the administrator.",
    );
  }
  return origin;
}

function parseOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SafeError("Enter a valid HTTPS SmarterMail server origin.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new SafeError(
      "Use an HTTPS server origin without a path, credentials, or query.",
    );
  }
  return url.origin;
}
