import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  useEffect: vi.fn(),
  useState: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useEffect: mocks.useEffect,
    useRef: () => ({ current: null }),
    useState: mocks.useState,
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/features/auth/actions/auth", () => ({ signOut: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: mocks.createClient,
}));

import Header from "@/components/layout/Header";

describe("Header auth state", () => {
  beforeEach(() => {
    mocks.createClient.mockReset();
    mocks.useEffect.mockReset();
    mocks.useState.mockReset();
    mocks.useEffect.mockImplementation((effect: () => unknown) => effect());
    mocks.useState.mockImplementation((initial: unknown) => [initial, vi.fn()]);
    mocks.createClient.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
        onAuthStateChange: vi.fn().mockReturnValue({
          data: { subscription: { unsubscribe: vi.fn() } },
        }),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the current session from the same-origin me API with cookies", () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "e2f21c1d-1aa7-49c3-a365-d33ae5f8a1c8", email: "buyer@example.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    Header();

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/me", expect.objectContaining({
      credentials: "include",
    }));
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
