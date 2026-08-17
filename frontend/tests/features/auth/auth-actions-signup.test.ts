import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("next/headers", () => ({
  headers: mocks.headers,
}));

import { signUp } from "@/features/auth/actions/auth";

function signUpForm(values: Record<string, string>) {
  const form = new FormData();
  Object.entries(values).forEach(([key, value]) => form.set(key, value));
  return form;
}

describe("signUp", () => {
  beforeEach(() => {
    mocks.createClient.mockReset();
    mocks.headers.mockReset();
    mocks.headers.mockResolvedValue(new Headers({
      host: "gamja.example",
      "x-forwarded-proto": "https",
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("posts normalized credentials, password confirmation, and display name to the signup API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "e2f21c1d-1aa7-49c3-a365-d33ae5f8a1c8", email: "buyer@example.com" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await signUp(
      signUpForm({
        email: " BUYER@EXAMPLE.COM ",
        password: "password123",
        passwordConfirmation: "password123",
        role: "buyer",
        displayName: "  감자 구매자  ",
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith("https://gamja.example/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        email: "buyer@example.com",
        password: "password123",
        password_confirmation: "password123",
        display_name: "감자 구매자",
      }),
    });
    expect(result.ok).toBe(true);
  });

  it("surfaces a duplicate-email response as the specified message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ code: "email_already_exists", message: "이미 사용 중인 이메일이에요." }),
          { status: 409, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await expect(signUp(signUpForm({
      email: "buyer@example.com",
      password: "password123",
      passwordConfirmation: "password123",
      displayName: "감자 구매자",
    }))).resolves.toMatchObject({
      ok: false,
      message: "이미 사용 중인 이메일이에요.",
    });
  });

  it("rejects an unsafe host header instead of fetching an arbitrary origin", async () => {
    mocks.headers.mockResolvedValue(new Headers({
      host: "gamja.example@127.0.0.1",
      "x-forwarded-proto": "https",
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(signUp(signUpForm({
      email: "buyer@example.com",
      password: "password123",
      passwordConfirmation: "password123",
      displayName: "감자 구매자",
    }))).rejects.toThrow(
      "Unable to determine a safe same-origin signup URL.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a mismatched passwordConfirmation before making a signup request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(signUp(signUpForm({
      email: "buyer@example.com",
      password: "password123",
      passwordConfirmation: "different-password",
      displayName: "감자 구매자",
    }))).resolves.toEqual({ ok: false, message: "비밀번호가 일치하지 않아요." });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a missing displayName before making a signup request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(signUp(signUpForm({
      email: "buyer@example.com",
      password: "password123",
      passwordConfirmation: "password123",
    }))).resolves.toMatchObject({ ok: false });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
