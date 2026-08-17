"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { parseSignInForm, parseSignUpForm } from "@/features/auth/lib/auth-input";
import { logServerError } from "@/lib/logging/server";
import { createClient } from "@/lib/supabase/server";

export type AuthActionState =
  | { ok: true; message: string }
  | { ok: false; message: string };

const DUPLICATE_EMAIL_MESSAGE = "이미 사용 중인 이메일이에요.";
const SIGNUP_FAILED_MESSAGE = "회원가입을 완료하지 못했어요. 잠시 후 다시 시도해주세요.";

function firstForwardedValue(value: string | null) {
  return value?.split(",")[0]?.trim();
}

async function getSameOriginSignupUrl() {
  const requestHeaders = await headers();
  const host = firstForwardedValue(requestHeaders.get("x-forwarded-host"))
    ?? requestHeaders.get("host")?.trim();
  const forwardedProtocol = firstForwardedValue(requestHeaders.get("x-forwarded-proto"));
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : process.env.NODE_ENV === "development" ? "http" : "https";

  if (!host || /[\s/@\\?#]/.test(host)) {
    throw new Error("Unable to determine a safe same-origin signup URL.");
  }

  try {
    const origin = new URL(`${protocol}://${host}`);
    if (origin.host !== host.toLowerCase() || origin.username || origin.password) {
      throw new Error("invalid host");
    }

    return new URL("/api/auth/signup", origin).toString();
  } catch {
    throw new Error("Unable to determine a safe same-origin signup URL.");
  }
}

export async function signUp(formData: FormData): Promise<AuthActionState> {
  const parsed = parseSignUpForm(formData);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  const signupUrl = await getSameOriginSignupUrl();
  let response: Response;
  try {
    response = await fetch(signupUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(parsed.data),
    });
  } catch (error) {
    await logServerError(error, { pathname: "/api/auth/signup" });
    return { ok: false, message: SIGNUP_FAILED_MESSAGE };
  }

  if (response.status === 409) return { ok: false, message: DUPLICATE_EMAIL_MESSAGE };
  if (!response.ok) return { ok: false, message: SIGNUP_FAILED_MESSAGE };

  return { ok: true, message: "회원가입이 완료됐어요. 로그인해주세요." };
}

export async function signIn(formData: FormData): Promise<AuthActionState> {
  const parsed = parseSignInForm(formData);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { ok: false, message: error.message };

  return { ok: true, message: "로그인했어요." };
}

export async function signOut() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
  redirect("/");
}
