import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  signIn: vi.fn(),
  useState: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useRef: () => ({ current: null }),
    useState: mocks.useState,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

vi.mock("@/features/auth/actions/auth", () => ({ signIn: mocks.signIn }));

import LoginForm from "@/features/auth/components/LoginForm";

type ReactElementLike = {
  type?: unknown;
  props?: { children?: unknown; onSubmit?: (event: React.FormEvent<HTMLFormElement>) => unknown };
};

function findElementByType(node: unknown, type: string): ReactElementLike | undefined {
  if (Array.isArray(node)) {
    return node.map((child) => findElementByType(child, type)).find(Boolean);
  }
  if (typeof node !== "object" || node === null) return undefined;

  const element = node as ReactElementLike;
  if (element.type === type) return element;
  return findElementByType(element.props?.children, type);
}

describe("LoginForm navigation", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.refresh.mockReset();
    mocks.signIn.mockReset();
    mocks.signIn.mockResolvedValue({ ok: true, message: "로그인했어요." });
    mocks.useState.mockReset();
    mocks.useState.mockImplementation((initial: unknown) => [initial, vi.fn()]);

    vi.stubGlobal("FormData", class {
      get(name: string) {
        return name === "email" ? "buyer@example.com" : "password123";
      }
    });
  });

  it("replaces to the requests list and refreshes after a successful sign-in", async () => {
    const form = findElementByType(LoginForm({ next: "/" }), "form");
    const event = {
      preventDefault: vi.fn(),
      currentTarget: {},
    } as unknown as React.FormEvent<HTMLFormElement>;

    await form?.props?.onSubmit?.(event);

    expect(mocks.signIn).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith("/requests");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
