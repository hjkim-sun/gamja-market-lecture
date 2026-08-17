import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ useEffect: vi.fn(), useState: vi.fn() }));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useEffect: mocks.useEffect, useRef: () => ({ current: null }), useState: mocks.useState };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/features/auth/actions/auth", () => ({ signOut: vi.fn() }));

import Header from "@/components/layout/Header";

describe("Header initial auth state from the server", () => {
  beforeEach(() => {
    mocks.useEffect.mockReset();
    mocks.useState.mockReset();
    mocks.useEffect.mockImplementation(() => undefined);
  });

  it("seeds the signed-in useState with the server-derived initialSignedIn prop, not a hardcoded false", () => {
    mocks.useState.mockImplementation((initial: unknown) => [initial, vi.fn()]);

    Header({ initialSignedIn: true });

    expect(mocks.useState).toHaveBeenNthCalledWith(1, true);
  });

  it("defaults to false when no initialSignedIn prop is given, so existing call sites keep working", () => {
    mocks.useState.mockImplementation((initial: unknown) => [initial, vi.fn()]);

    Header();

    expect(mocks.useState).toHaveBeenNthCalledWith(1, false);
  });

  it("renders the signed-in account menu on the very first render when initialSignedIn is true, with no interim login link", () => {
    mocks.useState.mockImplementation((initial: unknown) => [initial, vi.fn()]);

    const html = renderToStaticMarkup(Header({ initialSignedIn: true }));

    expect(html).toContain("내 계정");
    expect(html).not.toContain("로그인");
  });
});
