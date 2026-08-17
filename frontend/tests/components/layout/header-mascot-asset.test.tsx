import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

type ReactElementLike = {
  props?: { alt?: string; children?: unknown; src?: string; unoptimized?: boolean };
};

function findElementByAlt(node: unknown, alt: string): ReactElementLike | undefined {
  if (Array.isArray(node)) {
    return node.map((child) => findElementByAlt(child, alt)).find(Boolean);
  }
  if (typeof node !== "object" || node === null) return undefined;

  const element = node as ReactElementLike;
  if (element.props?.alt === alt) return element;
  return findElementByAlt(element.props?.children, alt);
}

describe("Header mascot asset", () => {
  beforeEach(() => {
    mocks.useEffect.mockReset();
    mocks.useState.mockReset();
    mocks.useEffect.mockImplementation(() => undefined);
    mocks.useState.mockImplementation((initial: unknown) => [initial, vi.fn()]);
  });

  it("uses the tracked public mascot directly instead of the image optimizer", () => {
    const mascotUrl = "/gamja-mascot.png";
    const publicAsset = fileURLToPath(new URL("../../../public/gamja-mascot.png", import.meta.url));

    expect(existsSync(publicAsset)).toBe(true);

    const mascot = findElementByAlt(Header(), "감자마켓 마스코트");
    expect(mascot?.props?.src).toBe(mascotUrl);
    expect(mascot?.props?.unoptimized).toBe(true);
  });
});
