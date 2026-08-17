import type { PurchaseRequest } from "@/types/request";
import { getSameOriginRequest } from "@/features/requests/lib/same-origin";

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

/** Fetches a single purchase request. Returns `null` when it does not exist (404) or on failure. */
export async function getRequestById(id: string): Promise<PurchaseRequest | null> {
  const { url } = await getSameOriginRequest(`/api/requests/${encodeURIComponent(id)}`);
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch {
    return null;
  }

  if (!response.ok) return null;
  return (await response.json()) as PurchaseRequest;
}
