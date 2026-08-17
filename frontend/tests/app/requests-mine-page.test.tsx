import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  getMyRequests: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/features/requests/data/requests-api", () => ({
  getMyRequests: mocks.getMyRequests,
}));

import MyRequestsPage from "@/app/requests/mine/page";

describe("/requests/mine", () => {
  it("redirects an unauthenticated visitor to login while preserving the return path", async () => {
    mocks.getMyRequests.mockResolvedValue({ ok: false, status: 401 });

    await MyRequestsPage();

    expect(mocks.redirect).toHaveBeenCalledWith("/login?next=/requests/mine");
  });

  it("renders the signed-in user's purchase-request cards with links to their details", async () => {
    mocks.getMyRequests.mockResolvedValue({
      ok: true,
      requests: [{
        id: "request-1",
        title: "닌텐도 스위치 OLED 화이트",
        category: "디지털기기",
        desiredPrice: 700000,
        status: "모집중",
        createdAt: "2026-08-17T00:00:00.000Z",
        description: "미개봉 또는 상태 좋은 제품을 찾고 있어요.",
        isOwner: true,
      }],
    });

    const html = renderToStaticMarkup(await MyRequestsPage());

    expect(html).toContain("닌텐도 스위치 OLED 화이트");
    expect(html).toContain("700,000원");
    expect(html).toContain('href="/requests/request-1"');
  });

  it("shows a non-error empty state and request-registration link when there are no purchase requests", async () => {
    mocks.getMyRequests.mockResolvedValue({ ok: true, requests: [] });

    const html = renderToStaticMarkup(await MyRequestsPage());

    expect(html).toContain("아직 등록한 구매요청이 없어요");
    expect(html).toContain('href="/requests/new"');
    expect(html).not.toMatch(/오류|에러|찾을 수 없어요/);
  });
});
