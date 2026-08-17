import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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

import Header from "@/components/layout/Header";

type ElementLike = {
  type?: unknown;
  props?: {
    children?: unknown;
    className?: string;
    href?: string;
    onClick?: () => void;
  };
};

function isElement(node: unknown): node is ElementLike {
  return typeof node === "object" && node !== null && "props" in node;
}

function childrenOf(node: unknown): unknown[] {
  if (!isElement(node)) return [];
  const { children } = node.props ?? {};
  return Array.isArray(children) ? children : children === undefined || children === null ? [] : [children];
}

function navigationItems(nodes: unknown[]): unknown[] {
  return nodes.flatMap((node) => {
    if (Array.isArray(node)) return navigationItems(node);
    if (isElement(node) && typeof node.type === "symbol") return navigationItems(childrenOf(node));
    return [node];
  });
}

function textContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return childrenOf(node).map(textContent).join("");
}

function findElement(node: unknown, predicate: (element: ElementLike) => boolean): ElementLike | undefined {
  if (isElement(node) && predicate(node)) return node;
  for (const child of childrenOf(node)) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return undefined;
}

function findElementsWithText(node: unknown, label: string): ElementLike[] {
  const matches: ElementLike[] = [];
  if (isElement(node) && textContent(node) === label) matches.push(node);
  for (const child of childrenOf(node)) matches.push(...findElementsWithText(child, label));
  return matches;
}

function renderHeader(state: boolean[]) {
  let hookIndex = 0;
  mocks.useState.mockImplementation((initial: boolean) => {
    const index = hookIndex++;
    return [state[index] ?? initial, (next: boolean | ((current: boolean) => boolean)) => {
      state[index] = typeof next === "function" ? next(state[index] ?? initial) : next;
    }];
  });
  return Header();
}

describe("Header account menu", () => {
  beforeEach(() => {
    mocks.useEffect.mockReset();
    mocks.useState.mockReset();
    mocks.useEffect.mockImplementation(() => undefined);
  });

  it("shows exactly the two account links before logout after a signed-in user opens the desktop account control", () => {
    const state = [true, false, false, false];
    let header = renderHeader(state);

    const accountButton = findElementsWithText(header, "내 계정").find((element) => typeof element.props?.onClick === "function");
    expect(accountButton).toBeDefined();
    accountButton?.props?.onClick?.();

    header = renderHeader(state);
    const accountMenu = findElement(header, (element) => element.props?.className === "gm-account-menu");
    const entries = childrenOf(accountMenu).filter(isElement).map(textContent).filter(Boolean);

    expect(entries).toEqual(["내 구매 요청", "내 판매 신청", "로그아웃"]);
    const links = childrenOf(accountMenu).filter(isElement).filter((element) => typeof element.props?.href === "string");
    expect(links.map((link) => [textContent(link), link.props?.href])).toEqual([
      ["내 구매 요청", "/requests/mine"],
      ["내 판매 신청", "/applications/mine"],
    ]);
  });

  it("does not render either account link anywhere for a signed-out user", () => {
    const header = renderHeader([false, true, false, false]);

    expect(findElementsWithText(header, "내 구매 요청")).toHaveLength(0);
    expect(findElementsWithText(header, "내 판매 신청")).toHaveLength(0);
  });

  it("places the same account links between the mobile account label and logout only for signed-in users", () => {
    const signedInHeader = renderHeader([true, true, false, false]);
    const mobileNav = findElement(signedInHeader, (element) => element.props?.className === "gm-mobile-nav");
    const mobileEntries = navigationItems(childrenOf(mobileNav)).filter(isElement).map(textContent);
    const accountIndex = mobileEntries.indexOf("내 계정");
    const logoutIndex = mobileEntries.indexOf("로그아웃");

    expect(mobileEntries.slice(accountIndex + 1, logoutIndex)).toEqual(["내 구매 요청", "내 판매 신청"]);

    const signedOutHeader = renderHeader([false, true, false, false]);
    expect(findElementsWithText(signedOutHeader, "내 구매 요청")).toHaveLength(0);
    expect(findElementsWithText(signedOutHeader, "내 판매 신청")).toHaveLength(0);
  });
});
