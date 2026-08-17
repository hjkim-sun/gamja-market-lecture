import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PurchaseRequest } from "@/types/request";

const mocks = vi.hoisted(() => ({
  getRequestById: vi.fn(),
}));

vi.mock("@/features/requests/data/requests-api", () => ({
  getRequestById: mocks.getRequestById,
}));

import RequestDetailPage from "@/app/requests/[id]/page";

const request = {
  id: "09f4d11d-6b5e-4f25-b17a-b9d0b7ad2fed",
  title: "아이폰 14 프로 128GB 자급제",
  category: "디지털기기" as const,
  desiredPrice: 750000,
  description: "상태 좋은 자급제 아이폰을 찾고 있습니다.",
  status: "모집중" as const,
  createdAt: "2026-08-17T00:00:00.000Z",
};

type ViewerRequest = Omit<typeof request, "status"> & {
  status: PurchaseRequest["status"];
  isOwner: boolean;
  applicationCount?: number;
  viewerChatThreadId?: string | null;
  viewerApplicationStatus?: "대기중" | "수락됨" | "거절됨" | null;
};

async function renderRequestDetail(viewerRequest: ViewerRequest) {
  mocks.getRequestById.mockResolvedValue(viewerRequest);

  return renderToStaticMarkup(await RequestDetailPage({
    params: Promise.resolve({ id: request.id }),
  } as never));
}

type Scenario = [name: string, viewerRequest: ViewerRequest, present: string[], absent: string[]];

describe("/requests/[id]", () => {
  it.each<Scenario>([
    [
      "anonymous visitor",
      { ...request, isOwner: false },
      ["이 요청에 지원하기", "disabled=\"\""],
      ["/apply"],
    ],
    [
      "owner with no applications on an open request",
      { ...request, isOwner: true, applicationCount: 0 },
      ["내가 등록한 요청이에요", "disabled=\"\""],
      ["이 요청에 지원하기", "지원자 보기"],
    ],
    [
      "owner with applications on an open request",
      { ...request, isOwner: true, applicationCount: 2 },
      ["내가 등록한 요청이에요", "지원자 보기 (2)", `/requests/${request.id}/applications`],
      ["이 요청에 지원하기"],
    ],
    [
      "owner of a matched request",
      { ...request, isOwner: true, status: "협의중" as const, viewerChatThreadId: "thread-1" },
      ["매칭된 판매자와 대화 중이에요", "채팅으로 이동", "/chats/thread-1"],
      ["이 요청에 지원하기"],
    ],
    [
      "owner of a matched request whose chat thread id the backend has not resolved",
      { ...request, isOwner: true, status: "협의중" as const },
      ["매칭된 판매자와 대화 중이에요", "채팅으로 이동", "href=\"/chats\""],
      ["이 요청에 지원하기"],
    ],
    [
      "eligible authenticated non-owner of an open request",
      { ...request, isOwner: false, viewerApplicationStatus: null },
      ["이 요청에 지원하기", `/requests/${request.id}/apply`],
      ["disabled=\"\"", "판매자 지원 기능은 이후 단계에서 열려요"],
    ],
    [
      "non-owner with a pending application",
      { ...request, isOwner: false, viewerApplicationStatus: "대기중" as const },
      ["지원 완료 · 답변 대기중", "disabled=\"\""],
      ["/apply"],
    ],
    [
      "non-owner with a rejected application",
      { ...request, isOwner: false, viewerApplicationStatus: "거절됨" as const },
      ["이 지원은 거절되었어요", "disabled=\"\""],
      ["/apply"],
    ],
    [
      "non-owner with an accepted application",
      { ...request, isOwner: false, viewerApplicationStatus: "수락됨" as const, viewerChatThreadId: "thread-2" },
      ["채팅으로 이동", "/chats/thread-2"],
      ["/apply"],
    ],
    [
      "unmatched non-owner after matching closes the request",
      { ...request, isOwner: false, status: "협의중" as const, viewerApplicationStatus: null },
      ["이미 매칭이 완료된 요청이에요", "disabled=\"\""],
      ["/apply"],
    ],
  ])("renders the specified action state for %s", async (_scenario, viewerRequest, present, absent) => {
    const html = await renderRequestDetail(viewerRequest);

    for (const text of present) expect(html).toContain(text);
    for (const text of absent) expect(html).not.toContain(text);
  });
});
