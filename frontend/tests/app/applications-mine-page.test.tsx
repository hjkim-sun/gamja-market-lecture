import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  getMyApplications: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/features/applications/data/applications-api", () => ({
  getMyApplications: mocks.getMyApplications,
}));

import MyApplicationsPage from "@/app/applications/mine/page";

describe("/applications/mine", () => {
  it("renders the signed-in seller's own applications with request titles and status", async () => {
    mocks.getMyApplications.mockResolvedValue({
      ok: true,
      applications: [{
        id: "application-1",
        requestId: "request-1",
        requestTitle: "닌텐도 스위치 OLED 화이트",
        offeredPrice: 700000,
        message: "동일 모델 재고가 있고 오늘 바로 거래할 수 있습니다.",
        status: "대기중",
        createdAt: "2026-08-17T00:00:00.000Z",
      }],
    });

    const html = renderToStaticMarkup(await MyApplicationsPage());

    expect(html).toContain("닌텐도 스위치 OLED 화이트");
    expect(html).toContain("대기중");
    expect(html).not.toContain("페이지를 찾을 수 없어요");
  });

  it("shows a no-applications message instead of an error when the seller has no applications", async () => {
    mocks.getMyApplications.mockResolvedValue({ ok: true, applications: [] });

    const html = renderToStaticMarkup(await MyApplicationsPage());

    expect(html).toContain("아직 판매 신청한 구매요청이 없어요");
    expect(html).not.toMatch(/오류|에러|찾을 수 없어요/);
  });

  it.each([401, 0])("redirects an unauthenticated visitor to login with a return path for backend status %s", async (status) => {
    mocks.getMyApplications.mockResolvedValue({ ok: false, status });

    await MyApplicationsPage();

    expect(mocks.redirect).toHaveBeenCalledWith("/login?next=/applications/mine");
  });
});
