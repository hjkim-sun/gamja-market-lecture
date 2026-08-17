import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  getApplicationsForRequest: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/features/applications/data/applications-api", () => ({
  getApplicationsForRequest: mocks.getApplicationsForRequest,
}));
vi.mock("@/features/applications/components/ApplicationList", () => ({
  default: ({ applications, requestId }: { applications: Array<{ sellerDisplayName: string }>; requestId: string }) => (
    <div data-request-id={requestId}>{applications.map((application) => application.sellerDisplayName).join(",")}</div>
  ),
}));

import RequestApplicationsPage from "@/app/requests/[id]/applications/page";

describe("/requests/[id]/applications", () => {
  it("renders the owner-only application list with the request id", async () => {
    mocks.getApplicationsForRequest.mockResolvedValue({
      ok: true,
      applications: [{
        id: "application-1",
        sellerDisplayName: "감자 판매자",
        offeredPrice: 700000,
        message: "동일 모델 재고가 있고 오늘 바로 거래할 수 있습니다.",
        status: "대기중",
        createdAt: "2026-08-17T00:00:00.000Z",
      }],
    });

    const html = renderToStaticMarkup(await RequestApplicationsPage({
      params: Promise.resolve({ id: "request-1" }),
    } as never));

    expect(html).toContain("감자 판매자");
    expect(html).toContain("data-request-id=\"request-1\"");
  });

  it.each([401, 403])("redirects an unauthorized list visitor for backend status %i", async (status) => {
    mocks.getApplicationsForRequest.mockResolvedValue({ ok: false, status });

    await RequestApplicationsPage({ params: Promise.resolve({ id: "request-1" }) } as never);

    expect(mocks.redirect).toHaveBeenCalledWith("/requests/request-1");
  });
});
