import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  getMyChatThreads: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/features/chats/data/chats-api", () => ({ getMyChatThreads: mocks.getMyChatThreads }));
vi.mock("@/features/chats/components/ChatThreadList", () => ({
  default: ({ threads }: { threads: Array<{ counterpartDisplayName: string }> }) => (
    <div>{threads.map((thread) => thread.counterpartDisplayName).join(",")}</div>
  ),
}));

import ChatsPage from "@/app/chats/page";

describe("/chats", () => {
  it("redirects an unauthenticated visitor while preserving the chat-list return path", async () => {
    mocks.getMyChatThreads.mockResolvedValue({ ok: false, status: 401 });

    await ChatsPage();

    expect(mocks.redirect).toHaveBeenCalledWith("/login?next=/chats");
  });

  it("renders participant thread summaries", async () => {
    mocks.getMyChatThreads.mockResolvedValue({
      ok: true,
      threads: [{
        id: "thread-1",
        requestId: "request-1",
        requestTitle: "닌텐도 스위치 OLED 화이트",
        counterpartDisplayName: "감자 판매자",
        viewerRole: "buyer",
        lastMessageAt: "2026-08-17T00:00:00.000Z",
      }],
    });

    const html = renderToStaticMarkup(await ChatsPage());

    expect(html).toContain("감자 판매자");
  });
});
