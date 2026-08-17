import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ getMyRequests: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/features/requests/data/requests-api", () => ({ getMyRequests: mocks.getMyRequests }));

import MyRequestsPage from "@/app/requests/mine/page";

describe("/requests/mine", () => {
  it("redirects unauthenticated visitors", async () => {
    mocks.getMyRequests.mockResolvedValue({ ok: false, status: 401 });
    await MyRequestsPage();
    expect(mocks.redirect).toHaveBeenCalledWith("/login?next=/requests/mine");
  });

  it("renders a zero count as text and a positive count as the applications link", async () => {
    mocks.getMyRequests.mockResolvedValue({ ok: true, requests: [
      { id: "zero", title: "지원 없음", category: "디지털기기", status: "모집중", desiredPrice: 1000, createdAt: "오늘", description: "설명", applicationCount: 0 },
      { id: "two", title: "지원 둘", category: "디지털기기", status: "모집중", desiredPrice: 2000, createdAt: "오늘", description: "설명", applicationCount: 2 },
    ] });
    const html = renderToStaticMarkup(await MyRequestsPage());
    expect(html).toContain("현재 지원자 수: 0명");
    expect(html).toContain('href="/requests/two/applications"');
    expect(html).toContain("현재 지원자 수: 2명");
  });
});
