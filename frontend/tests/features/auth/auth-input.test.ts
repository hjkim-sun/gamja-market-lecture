import { describe, expect, it } from "vitest";
import { parseSignUpForm, safeNextPath } from "@/features/auth/lib/auth-input";

function signUpForm(values: Record<string, string>) {
  const form = new FormData();
  Object.entries(values).forEach(([key, value]) => form.set(key, value));
  return form;
}

describe("parseSignUpForm", () => {
  it("accepts only email and password, normalizing the email", () => {
    expect(
      parseSignUpForm(
        signUpForm({
          email: " BUYER@EXAMPLE.COM ",
          password: "password123",
        }),
      ),
    ).toEqual({
      ok: true,
      data: {
        email: "buyer@example.com",
        password: "password123",
      },
    });
  });

  it("accepts an eight-or-more-character password containing a leading symbol", () => {
    expect(
      parseSignUpForm(
        signUpForm({ email: "user@example.com", password: "!test1234" }),
      ),
    ).toEqual({
      ok: true,
      data: {
        email: "user@example.com",
        password: "!test1234",
      },
    });
  });

  it("rejects malformed emails and passwords shorter than eight characters", () => {
    expect(
      parseSignUpForm(
        signUpForm({ email: "not-an-email", password: "password123" }),
      ),
    ).toEqual({ ok: false, message: "유효한 이메일 주소를 입력해 주세요." });

    expect(
      parseSignUpForm(signUpForm({ email: "user@example.com", password: "short" })),
    ).toEqual({ ok: false, message: "비밀번호는 8자 이상이어야 해요." });
  });
});

describe("safeNextPath", () => {
  it("does not allow callback redirects to another origin", () => {
    expect(safeNextPath("/requests")).toBe("/requests");
    expect(safeNextPath("https://attacker.example")).toBe("/");
    expect(safeNextPath("//attacker.example")).toBe("/");
  });
});
