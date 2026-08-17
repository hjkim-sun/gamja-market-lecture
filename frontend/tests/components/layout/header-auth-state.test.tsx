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

type ReactElementLike = {
  props?: { children?: unknown; className?: string };
};

function textContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (typeof node !== "object" || node === null) return "";
  return textContent((node as ReactElementLike).props?.children);
}

function findElementByClass(node: unknown, className: string): ReactElementLike | undefined {
  if (Array.isArray(node)) {
    return node.map((child) => findElementByClass(child, className)).find(Boolean);
  }
  if (typeof node !== "object" || node === null) return undefined;

  const element = node as ReactElementLike;
  if (element.props?.className === className) return element;
  return findElementByClass(element.props?.children, className);
}

describe("Header auth state", () => {
  let hookIndex = 0;
  let hookValues: unknown[] = [];

  beforeEach(() => {
    mocks.createClient.mockReset();
    mocks.useEffect.mockReset();
    mocks.useState.mockReset();
    hookIndex = 0;
    hookValues = [];
    mocks.useEffect.mockImplementation((effect: () => unknown) => effect());
    mocks.useState.mockImplementation((initial: unknown) => {
      const index = hookIndex++;
      if (!(index in hookValues)) hookValues[index] = initial;
      return [hookValues[index], (value: unknown) => {
        hookValues[index] = typeof value === "function"
          ? (value as (previous: unknown) => unknown)(hookValues[index])
          : value;
      }];
    });
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

  function renderHeader() {
    hookIndex = 0;
    return Header();
  }

  it("reads the current session from the same-origin me API with cookies", () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "e2f21c1d-1aa7-49c3-a365-d33ae5f8a1c8", email: "buyer@example.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderHeader();

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/me", expect.objectContaining({
      credentials: "include",
    }));
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("renders the me API email as the authenticated account greeting", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: "e2f21c1d-1aa7-49c3-a365-d33ae5f8a1c8",
        email: "buyer@example.com",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderHeader();
    await Promise.resolve();
    await Promise.resolve();
    const account = findElementByClass(renderHeader(), "gm-account-wrap");

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/me", expect.objectContaining({
      credentials: "include",
      cache: "no-store",
    }));
    expect(textContent(account)).toContain("안녕하세요, buyer@example.com님");
    expect(textContent(account)).not.toContain("내 계정");
  });
});
