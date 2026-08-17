import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  getRequests: vi.fn(),
}));

vi.mock("@/features/requests/data/requests-api", () => ({
  getRequests: mocks.getRequests,
}));

import RequestsPage from "@/app/requests/page";

describe("/requests", () => {
  it("loads requests from the API and provides a registration CTA for an empty list", async () => {
    mocks.getRequests.mockResolvedValue([]);

    const html = renderToStaticMarkup(await RequestsPage());

    expect(mocks.getRequests).toHaveBeenCalledOnce();
    expect(html).toContain("아직 등록된 구매요청이 없어요");
    expect(html).toContain("첫 요청을 등록해보세요");
    expect(html).toContain('href="/requests/new"');
  });
});
