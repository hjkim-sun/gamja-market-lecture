import type { MyApplication, OwnerApplication } from "@/types/application";
import { getSameOriginRequest } from "@/lib/api/same-origin-request";

export type ApplicationsForRequestResult =
  | { ok: true; applications: OwnerApplication[] }
  | { ok: false; status: number };

/**
 * Fetches the applications submitted for a request, as seen by the request owner.
 * Surfaces the backend status on failure so the owner-only page can distinguish
 * "not authenticated" from "not the owner" and redirect accordingly.
 */
export async function getApplicationsForRequest(requestId: string): Promise<ApplicationsForRequestResult> {
  const { cookie, url } = await getSameOriginRequest(
    `/api/requests/${encodeURIComponent(requestId)}/applications`,
  );
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: cookie ? { Cookie: cookie } : undefined,
    });
  } catch {
    return { ok: false, status: 0 };
  }

  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true, applications: (await response.json()) as OwnerApplication[] };
}

export type MyApplicationsResult =
  | { ok: true; applications: MyApplication[] }
  | { ok: false; status: number };

/**
 * Fetches the signed-in seller's own applications. Surfaces the backend status on
 * failure so the page can distinguish "not authenticated" (401) from a genuinely
 * empty list, instead of collapsing every failure into `[]`.
 */
export async function getMyApplications(): Promise<MyApplicationsResult> {
  const { cookie, url } = await getSameOriginRequest("/api/applications/mine");
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: cookie ? { Cookie: cookie } : undefined,
    });
  } catch {
    return { ok: false, status: 0 };
  }

  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true, applications: (await response.json()) as MyApplication[] };
}
