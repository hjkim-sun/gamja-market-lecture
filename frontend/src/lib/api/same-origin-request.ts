import { headers } from "next/headers";

const UNSAFE_ORIGIN_MESSAGE = "Unable to determine a safe same-origin requests URL.";

function firstForwardedValue(value: string | null) {
  return value?.split(",")[0]?.trim();
}

/**
 * Builds an absolute same-origin URL for a backend-proxied `/api/*` route from the
 * incoming request's headers. Shared by every feature (requests, applications, chats,
 * auth) so the origin-resolution/hardening logic lives in exactly one place.
 */
export async function getSameOriginRequest(
  pathname:
    | `/api/requests${string}`
    | `/api/applications${string}`
    | `/api/chats${string}`
    | `/api/auth/${string}`,
) {
  const requestHeaders = await headers();
  const host = firstForwardedValue(requestHeaders.get("x-forwarded-host"))
    ?? requestHeaders.get("host")?.trim();
  const forwardedProtocol = firstForwardedValue(requestHeaders.get("x-forwarded-proto"));
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : process.env.NODE_ENV === "development" ? "http" : "https";

  if (!host || /[\s/@\\?#]/.test(host)) {
    throw new Error(UNSAFE_ORIGIN_MESSAGE);
  }

  try {
    const origin = new URL(`${protocol}://${host}`);
    if (origin.host !== host.toLowerCase() || origin.username || origin.password) {
      throw new Error("invalid host");
    }

    return {
      cookie: requestHeaders.get("cookie"),
      url: new URL(pathname, origin).toString(),
    };
  } catch {
    throw new Error(UNSAFE_ORIGIN_MESSAGE);
  }
}
