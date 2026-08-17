import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getIsSignedIn: vi.fn(),
  Header: vi.fn(() => null),
}));

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "--font-geist-sans" }),
  Geist_Mono: () => ({ variable: "--font-geist-mono" }),
}));
vi.mock("@/features/auth/data/session", () => ({ getIsSignedIn: mocks.getIsSignedIn }));
vi.mock("@/components/layout/Header", () => ({ default: mocks.Header }));
vi.mock("@/components/layout/Footer", () => ({ default: () => null }));

import RootLayout from "@/app/layout";

type ElementLike = { type?: unknown; props?: { children?: unknown; initialSignedIn?: boolean } };

function findElement(node: unknown, type: unknown): ElementLike | undefined {
  if (typeof node !== "object" || node === null) return undefined;
  const element = node as ElementLike;
  if (element.type === type) return element;
  const children = element.props?.children;
  if (Array.isArray(children)) {
    return children.map((child) => findElement(child, type)).find(Boolean);
  }
  return findElement(children, type);
}

describe("RootLayout", () => {
  it("passes the server-derived signed-in state to Header instead of letting it start unauthenticated", async () => {
    mocks.getIsSignedIn.mockResolvedValue(true);

    const tree = await RootLayout({ children: null } as never);
    const header = findElement(tree, mocks.Header);

    expect(mocks.getIsSignedIn).toHaveBeenCalledOnce();
    expect(header?.props).toMatchObject({ initialSignedIn: true });
  });
});
