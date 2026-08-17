import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));

import { sendChatMessage } from "@/features/chats/actions/chats";

describe("sendChatMessage", () => {
  beforeEach(() => {
    mocks.headers.mockReset();
    mocks.headers.mockResolvedValue(new Headers({
      host: "gamja.example",
      "x-forwarded-proto": "https",
      cookie: "gm_session=abc",
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the message body to the thread's messages endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "message-1",
      senderId: "buyer-1",
      body: "네, 오늘 오후 가능하신가요?",
      createdAt: "2026-08-17T00:00:00.000Z",
    }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendChatMessage("thread-1", "네, 오늘 오후 가능하신가요?");

    expect(fetchMock).toHaveBeenCalledWith("https://gamja.example/api/chats/thread-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "gm_session=abc" },
      credentials: "include",
      body: JSON.stringify({ body: "네, 오늘 오후 가능하신가요?" }),
    });
    expect(result).toEqual({
      ok: true,
      message: {
        id: "message-1",
        senderId: "buyer-1",
        body: "네, 오늘 오후 가능하신가요?",
        createdAt: "2026-08-17T00:00:00.000Z",
      },
    });
  });

  it("surfaces the backend's validation message on 400", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "invalid_input", message: "메시지를 입력해주세요." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    ));

    const result = await sendChatMessage("thread-1", "");

    expect(result).toEqual({ ok: false, error: "메시지를 입력해주세요." });
  });

  it("falls back to a generic message on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await sendChatMessage("thread-1", "hello");

    expect(result).toEqual({ ok: false, error: "메시지를 보내지 못했어요. 잠시 후 다시 시도해주세요." });
  });
});
