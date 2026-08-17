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

type ElementLike = {
  props?: {
    children?: unknown;
    className?: string;
  };
};

function isElement(node: unknown): node is ElementLike {
  return typeof node === "object" && node !== null && "props" in node;
}

function textContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!isElement(node)) return "";
  const { children } = node.props ?? {};
  return (Array.isArray(children) ? children : [children]).map(textContent).join("");
}

function findElementByClassName(node: unknown, className: string): ElementLike | undefined {
  if (isElement(node) && node.props?.className === className) return node;
  if (!isElement(node)) return undefined;
  const { children } = node.props ?? {};
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findElementByClassName(child, className);
    if (found) return found;
  }
  return undefined;
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

  function createStatefulRenderer() {
    const state: unknown[] = [];
    const renderHeader = () => {
      let hookIndex = 0;
      mocks.useState.mockImplementation((initial: unknown) => {
        const index = hookIndex++;
        return [state[index] ?? initial, (next: unknown) => {
          state[index] = typeof next === "function" ? (next as (current: unknown) => unknown)(state[index]) : next;
        }];
      });
      let effectIndex = 0;
      mocks.useEffect.mockImplementation((effect: () => unknown) => {
        // Only the first effect (the /api/auth/me fetch) needs to actually run here;
        // the mobile-drawer keydown effect touches `document`, which this test's node
        // environment does not provide, so it is left as a no-op like the other Header
        // test files do.
        if (effectIndex++ === 0) effect();
      });
      return Header();
    };
    return { renderHeader, state };
  }

  async function flushMicrotasks() {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("renders an authenticated user's display name in the account UI", async () => {
    const publicUser = {
      id: "e2f21c1d-1aa7-49c3-a365-d33ae5f8a1c8",
      email: "buyer@example.com",
      display_name: "감자 구매자",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(publicUser), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    const { renderHeader, state } = createStatefulRenderer();
    renderHeader();
    await flushMicrotasks();

    let header = renderHeader();
    expect(state[5]).toBe("감자 구매자");
    expect(textContent(findElementByClassName(header, "gm-account-button"))).toBe("감자 구매자");

    state[2] = true; // open the mobile drawer to reveal the mobile account label
    header = renderHeader();
    expect(textContent(findElementByClassName(header, "gm-mobile-account"))).toBe("감자 구매자");
  });

  it("falls back to the default account label when the me response has no display_name", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "e2f21c1d-1aa7-49c3-a365-d33ae5f8a1c8",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    const { renderHeader, state } = createStatefulRenderer();
    renderHeader();
    await flushMicrotasks();

    const header = renderHeader();
    expect(state[5]).toBeNull();
    expect(textContent(findElementByClassName(header, "gm-account-button"))).toBe("내 계정");
  });

  it("clears the retained display name when the me check fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    const { renderHeader, state } = createStatefulRenderer();
    state[5] = "감자 구매자";
    renderHeader();
    await flushMicrotasks();

    expect(state[0]).toBe(false);
    expect(state[5]).toBeNull();
  });

  it("clears the retained display name on logout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "e2f21c1d-1aa7-49c3-a365-d33ae5f8a1c8",
      email: "buyer@example.com",
      display_name: "감자 구매자",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    const { renderHeader, state } = createStatefulRenderer();
    renderHeader();
    await flushMicrotasks();
    state[2] = true; // open the mobile drawer to reach the mobile logout button
    let header = renderHeader();
    expect(state[5]).toBe("감자 구매자");

    const logoutButton = findElementByClassName(header, "gm-mobile-logout") as {
      props?: { onClick?: () => Promise<void> };
    };
    await logoutButton.props?.onClick?.();

    header = renderHeader();
    expect(state[5]).toBeNull();
  });

  it("uses the email greeting when the me response has no display_name", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "e2f21c1d-1aa7-49c3-a365-d33ae5f8a1c8",
      email: "buyer@example.com",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    const { renderHeader } = createStatefulRenderer();
    renderHeader();
    await flushMicrotasks();

    expect(textContent(findElementByClassName(renderHeader(), "gm-account-button"))).toBe("안녕하세요, buyer@example.com님");
  });
});
