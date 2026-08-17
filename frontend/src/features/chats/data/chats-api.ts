import type { ChatThreadDetail, ChatThreadSummary } from "@/types/chat";
import { getSameOriginRequest } from "@/lib/api/same-origin-request";

export type MyChatThreadsResult =
  | { ok: true; threads: ChatThreadSummary[] }
  | { ok: false; status: number };

export type ChatThreadResult =
  | { ok: true; thread: ChatThreadDetail }
  | { ok: false; status: number };

/** Fetches the signed-in viewer's chat threads via `GET /api/chats`. */
export async function getMyChatThreads(): Promise<MyChatThreadsResult> {
  const { cookie, url } = await getSameOriginRequest("/api/chats");
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
  return { ok: true, threads: (await response.json()) as ChatThreadSummary[] };
}

/**
 * Fetches a single chat thread with its full message history via `GET /api/chats/{id}`.
 * Surfaces the backend status so the page can tell an expired session (401) apart
 * from a thread the viewer does not participate in (403/404).
 */
export async function getChatThreadById(id: string): Promise<ChatThreadResult> {
  const { cookie, url } = await getSameOriginRequest(`/api/chats/${encodeURIComponent(id)}`);
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
  return { ok: true, thread: (await response.json()) as ChatThreadDetail };
}
