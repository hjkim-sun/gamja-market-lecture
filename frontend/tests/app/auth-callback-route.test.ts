import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { GET } from "@/app/auth/callback/route";

describe("GET /auth/callback", () => {
  beforeEach(() => {
    mocks.createClient.mockReset();
    mocks.exchangeCodeForSession.mockReset();
    mocks.createClient.mockResolvedValue({
      auth: { exchangeCodeForSession: mocks.exchangeCodeForSession },
    });
  });

  it("redirects a successfully exchanged code to the verification result", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });

    const response = await GET(
      new NextRequest("http://localhost:3000/auth/callback?code=one-time-code&next=https://attacker.example"),
    );

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("one-time-code");
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/email-verified?status=verified",
    );
  });

  it("redirects a missing or rejected code to the invalid-link result", async () => {
    const missingCode = await GET(new NextRequest("http://localhost:3000/auth/callback"));
    expect(missingCode.headers.get("location")).toBe(
      "http://localhost:3000/email-verified?status=invalid-link",
    );
    expect(mocks.createClient).not.toHaveBeenCalled();

    mocks.exchangeCodeForSession.mockResolvedValue({ error: new Error("expired") });
    const rejectedCode = await GET(new NextRequest("http://localhost:3000/auth/callback?code=expired"));
    expect(rejectedCode.headers.get("location")).toBe(
      "http://localhost:3000/email-verified?status=invalid-link",
    );
  });

  it("redirects unexpected server failures to the recoverable failed result", async () => {
    mocks.createClient.mockRejectedValue(new Error("configuration unavailable"));

    const response = await GET(new NextRequest("http://localhost:3000/auth/callback?code=one-time-code"));

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/email-verified?status=failed",
    );
  });
});
