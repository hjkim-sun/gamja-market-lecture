import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: mocks.headers,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/features/requests/components/RequestForm", () => ({
  default: () => <div data-testid="request-form" />,
}));

import RequestCreatePage from "@/app/requests/new/page";

describe("/requests/new", () => {
  it("redirects an unauthenticated visitor to login and preserves the safe return path", async () => {
    mocks.headers.mockResolvedValue(new Headers({
      host: "gamja.example",
      "x-forwarded-proto": "https",
      cookie: "gm_session=expired-session",
    }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await RequestCreatePage();

    expect(fetchMock).toHaveBeenCalledWith("https://gamja.example/api/auth/me", {
      headers: { Cookie: "gm_session=expired-session" },
      credentials: "include",
    });
    expect(mocks.redirect).toHaveBeenCalledWith("/login?next=/requests/new");
    vi.unstubAllGlobals();
  });
});
