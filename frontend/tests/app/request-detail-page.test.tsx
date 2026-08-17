import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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

async function renderRequestDetail(isOwner: boolean) {
  mocks.getRequestById.mockResolvedValue({ ...request, isOwner });

  return renderToStaticMarkup(await RequestDetailPage({
    params: Promise.resolve({ id: request.id }),
  } as never));
}

describe("/requests/[id]", () => {
  it("shows an owner-specific non-application state to the authenticated request owner", async () => {
    const html = await renderRequestDetail(true);

    expect(html).toContain("내가 등록한 요청이에요");
    expect(html).not.toContain("이 요청에 지원하기");
  });

  it("preserves the future application placeholder for anonymous and non-owner visitors", async () => {
    for (const isOwner of [false, false]) {
      const html = await renderRequestDetail(isOwner);

      expect(html).toContain("이 요청에 지원하기");
      expect(html).toContain("판매자 지원 기능은 이후 단계에서 열려요");
      expect(html).not.toContain("내가 등록한 요청이에요");
    }
  });
});
