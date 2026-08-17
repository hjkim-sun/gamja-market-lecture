import type { PurchaseRequest } from "@/types/request";
import { getSameOriginRequest } from "@/lib/api/same-origin-request";

/** Fetches the full purchase-request list from the backend. Returns `[]` on any failure. */
export async function getRequests(): Promise<PurchaseRequest[]> {
  const { url } = await getSameOriginRequest("/api/requests");
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch {
    return [];
  }

  if (!response.ok) return [];
  return (await response.json()) as PurchaseRequest[];
}

/**
 * Fetches a single purchase request. Returns `null` only when the backend confirms the
 * request does not exist (404). Non-404 error responses and network failures propagate so
 * the route's load-error boundary can render instead of the not-found UI.
 * Forwards the incoming request's cookies so the backend can identify the authenticated
 * viewer and report whether they own the request.
 */
export async function getRequestById(id: string): Promise<PurchaseRequest | null> {
  const { cookie, url } = await getSameOriginRequest(`/api/requests/${encodeURIComponent(id)}`);
  const response = await fetch(url, {
    cache: "no-store",
    headers: cookie ? { Cookie: cookie } : undefined,
  });

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Failed to fetch request ${id}: ${response.status}`);
  return (await response.json()) as PurchaseRequest;
}

export type MyRequestsResult =
  | { ok: true; requests: PurchaseRequest[] }
  | { ok: false; status: number };

/**
 * Fetches the signed-in buyer's own purchase requests. Surfaces the backend status on
 * failure so the page can distinguish "not authenticated" (401) from a genuinely
 * empty list, instead of collapsing every failure into `[]`.
 */
export async function getMyRequests(): Promise<MyRequestsResult> {
  const { cookie, url } = await getSameOriginRequest("/api/requests/mine");
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
  return { ok: true, requests: (await response.json()) as PurchaseRequest[] };
}
