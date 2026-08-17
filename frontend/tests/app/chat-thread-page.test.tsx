import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  getChatThreadById: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/features/chats/data/chats-api", () => ({ getChatThreadById: mocks.getChatThreadById }));
vi.mock("@/features/chats/components/ChatThread", () => ({
  default: ({ thread }: { thread: { messages: Array<{ body: string; senderId: string }>; viewerId: string } }) => (
    <div data-viewer-id={thread.viewerId}>{thread.messages.map((message) => message.body).join(",")}</div>
  ),
}));

import ChatThreadPage from "@/app/chats/[id]/page";

describe("/chats/[id]", () => {
  it.each([401, 403, 404])("redirects unavailable thread status %i to the safe chat list", async (status) => {
    mocks.getChatThreadById.mockResolvedValue({ ok: false, status });

    await ChatThreadPage({ params: Promise.resolve({ id: "thread-1" }) } as never);

    expect(mocks.redirect).toHaveBeenCalledWith(status === 401 ? "/login?next=/chats/thread-1" : "/chats");
  });

  it("passes the viewer id and initial messages to the polling chat thread", async () => {
    mocks.getChatThreadById.mockResolvedValue({
      ok: true,
      thread: {
        id: "thread-1",
        requestId: "request-1",
        requestTitle: "닌텐도 스위치 OLED 화이트",
        buyerDisplayName: "구매 감자",
        sellerDisplayName: "판매 감자",
        viewerId: "buyer-1",
        messages: [{ id: "message-1", senderId: "seller-1", body: "오늘 오후 가능하신가요?", createdAt: "2026-08-17T00:00:00.000Z" }],
      },
    });

    const html = renderToStaticMarkup(await ChatThreadPage({
      params: Promise.resolve({ id: "thread-1" }),
    } as never));

    expect(html).toContain("data-viewer-id=\"buyer-1\"");
    expect(html).toContain("오늘 오후 가능하신가요?");
  });
});
