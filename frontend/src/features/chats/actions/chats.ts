"use server";

import { getSameOriginRequest } from "@/lib/api/same-origin-request";
import { logServerError } from "@/lib/logging/server";
import type { ChatMessage } from "@/types/chat";

export type SendChatMessageState =
  | { ok: true; message: ChatMessage }
  | { ok: false; error: string };

const SEND_FAILED_MESSAGE = "메시지를 보내지 못했어요. 잠시 후 다시 시도해주세요.";

/** Sends a chat message via `POST /api/chats/{id}/messages`. */
export async function sendChatMessage(
  threadId: string,
  body: string,
): Promise<SendChatMessageState> {
  const { cookie, url } = await getSameOriginRequest(`/api/chats/${encodeURIComponent(threadId)}/messages`);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      credentials: "include",
      body: JSON.stringify({ body }),
    });
  } catch (error) {
    await logServerError(error, { pathname: `/api/chats/${threadId}/messages` });
    return { ok: false, error: SEND_FAILED_MESSAGE };
  }

  if (!response.ok) {
    if (response.status >= 500) {
      await logServerError(new Error(`Chat message send failed with status ${response.status}`), {
        pathname: `/api/chats/${threadId}/messages`,
      });
    }
    const errorBody = await response.json().catch(() => null) as { message?: unknown } | null;
    return {
      ok: false,
      error: typeof errorBody?.message === "string" ? errorBody.message : SEND_FAILED_MESSAGE,
    };
  }

  return { ok: true, message: (await response.json()) as ChatMessage };
}
