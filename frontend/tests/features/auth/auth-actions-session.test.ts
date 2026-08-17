import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  headers: vi.fn(),
  redirect: vi.fn(),
  supabaseSignIn: vi.fn(),
  supabaseSignOut: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("next/headers", () => ({
  headers: mocks.headers,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import { signIn, signOut } from "@/features/auth/actions/auth";

function credentialsForm(email = " BUYER@EXAMPLE.COM ", password = "password123") {
  const form = new FormData();
  form.set("email", email);
  form.set("password", password);
  return form;
}

describe("FastAPI session actions", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.headers.mockResolvedValue(new Headers({
      host: "gamja.example",
      "x-forwarded-proto": "https",
    }));
    mocks.supabaseSignIn.mockResolvedValue({ error: null });
    mocks.supabaseSignOut.mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({
      auth: {
        signInWithPassword: mocks.supabaseSignIn,
        signOut: mocks.supabaseSignOut,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts normalized credentials to the same-origin login API with cookies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "e2f21c1d-1aa7-49c3-a365-d33ae5f8a1c8", email: "buyer@example.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await signIn(credentialsForm());

    expect(fetchMock).toHaveBeenCalledWith("https://gamja.example/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: "buyer@example.com", password: "password123" }),
    });
    expect(result).toEqual({ ok: true, message: "로그인했어요." });
    expect(mocks.supabaseSignIn).not.toHaveBeenCalled();
  });

  it("maps login 401 responses to the fixed invalid-credentials message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "invalid_credentials", message: "provider detail" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    mocks.supabaseSignIn.mockResolvedValue({ error: { message: "Supabase account detail" } });

    await expect(signIn(credentialsForm("buyer@example.com"))).resolves.toEqual({
      ok: false,
      message: "이메일 또는 비밀번호가 올바르지 않아요.",
    });
  });

  it("posts to the same-origin logout API with cookies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await signOut();

    expect(fetchMock).toHaveBeenCalledWith("https://gamja.example/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    expect(mocks.supabaseSignOut).not.toHaveBeenCalled();
  });
});
