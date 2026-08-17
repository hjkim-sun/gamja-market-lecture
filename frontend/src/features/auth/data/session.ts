import { getSameOriginRequest } from "@/lib/api/same-origin-request";

/** True iff the incoming request carries a valid session, per `GET /api/auth/me`. */
export async function getIsSignedIn(): Promise<boolean> {
  const { cookie, url } = await getSameOriginRequest("/api/auth/me");
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: cookie ? { Cookie: cookie } : undefined,
    });
    return response.ok;
  } catch {
    return false;
  }
}
