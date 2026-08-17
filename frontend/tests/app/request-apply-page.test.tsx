import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/features/applications/components/ApplyForm", () => ({
  default: ({ requestId }: { requestId: string }) => <div data-request-id={requestId}>apply form</div>,
}));

import RequestApplyPage from "@/app/requests/[id]/apply/page";

describe("/requests/[id]/apply", () => {
  it("preserves the specific application URL when an unauthenticated visitor is redirected", async () => {
    mocks.headers.mockResolvedValue(new Headers({
      host: "gamja.example",
      "x-forwarded-proto": "https",
      cookie: "gm_session=expired-session",
    }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await RequestApplyPage({ params: Promise.resolve({ id: "request-1" }) } as never);

    expect(fetchMock).toHaveBeenCalledWith("https://gamja.example/api/auth/me", {
      headers: { Cookie: "gm_session=expired-session" },
      credentials: "include",
    });
    expect(mocks.redirect).toHaveBeenCalledWith("/login?next=/requests/request-1/apply");
    vi.unstubAllGlobals();
  });
});
