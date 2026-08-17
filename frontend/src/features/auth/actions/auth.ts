"use server";

import { headers } from "next/headers";
import { parseSignInForm, parseSignUpForm } from "@/features/auth/lib/auth-input";
import { logServerError } from "@/lib/logging/server";

export type AuthActionState =
  | { ok: true; message: string }
  | { ok: false; message: string };

const DUPLICATE_EMAIL_MESSAGE = "이미 사용 중인 이메일이에요.";
const DUPLICATE_DISPLAY_NAME_MESSAGE = "이미 사용 중인 표시 이름이에요.";
const SIGNUP_FAILED_MESSAGE = "회원가입을 완료하지 못했어요. 잠시 후 다시 시도해주세요.";
const INVALID_CREDENTIALS_MESSAGE = "이메일 또는 비밀번호가 올바르지 않아요.";
const LOGIN_FAILED_MESSAGE = "로그인하지 못했어요. 잠시 후 다시 시도해주세요.";

function firstForwardedValue(value: string | null) {
  return value?.split(",")[0]?.trim();
}

async function getSameOriginAuthRequest(pathname: `/api/auth/${string}`) {
  const unsafeOriginMessage = pathname === "/api/auth/signup"
    ? "Unable to determine a safe same-origin signup URL."
    : "Unable to determine a safe same-origin auth URL.";
  const requestHeaders = await headers();
  const host = firstForwardedValue(requestHeaders.get("x-forwarded-host"))
    ?? requestHeaders.get("host")?.trim();
  const forwardedProtocol = firstForwardedValue(requestHeaders.get("x-forwarded-proto"));
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : process.env.NODE_ENV === "development" ? "http" : "https";

  if (!host || /[\s/@\\?#]/.test(host)) {
    throw new Error(unsafeOriginMessage);
  }

  try {
    const origin = new URL(`${protocol}://${host}`);
    if (origin.host !== host.toLowerCase() || origin.username || origin.password) {
      throw new Error("invalid host");
    }

    return {
      cookie: requestHeaders.get("cookie"),
      url: new URL(pathname, origin).toString(),
    };
  } catch {
    throw new Error(unsafeOriginMessage);
  }
}

async function applySessionCookie(response: Response) {
  const setCookie = response.headers.get("set-cookie");
  const sessionCookie = setCookie?.match(/(?:^|,\s*)gm_session=([^;]*)/i);
  if (!setCookie || !sessionCookie) return;

  const { cookies } = await import("next/headers");
  const maxAge = setCookie?.match(/;\s*max-age=(-?\d+)/i)?.[1];
  const expires = setCookie?.match(/;\s*expires=([^;]+)/i)?.[1];
  const sameSite = setCookie?.match(/;\s*samesite=(lax|strict|none)/i)?.[1].toLowerCase();

  (await cookies()).set({
    name: "gm_session",
    value: sessionCookie[1],
    httpOnly: /;\s*httponly(?:;|$)/i.test(setCookie),
    secure: /;\s*secure(?:;|$)/i.test(setCookie),
    path: setCookie?.match(/;\s*path=([^;]+)/i)?.[1] ?? "/",
    ...(maxAge ? { maxAge: Number(maxAge) } : {}),
    ...(expires ? { expires: new Date(expires) } : {}),
    ...(sameSite === "lax" || sameSite === "strict" || sameSite === "none"
      ? { sameSite }
      : {}),
  });
}

export async function signUp(formData: FormData): Promise<AuthActionState> {
  const parsed = parseSignUpForm(formData);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  const { cookie, url } = await getSameOriginAuthRequest("/api/auth/signup");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      credentials: "include",
      body: JSON.stringify({
        email: parsed.data.email,
        password: parsed.data.password,
        password_confirmation: parsed.data.passwordConfirmation,
        display_name: parsed.data.displayName,
      }),
    });
  } catch (error) {
    await logServerError(error, { pathname: "/api/auth/signup" });
    return { ok: false, message: SIGNUP_FAILED_MESSAGE };
  }

  if (response.status === 409) {
    const code = await response
      .json()
      .then((body: unknown) => (
        typeof body === "object" && body !== null && "code" in body
          ? (body as { code?: unknown }).code
          : undefined
      ))
      .catch(() => undefined);

    return {
      ok: false,
      message: code === "display_name_already_exists"
        ? DUPLICATE_DISPLAY_NAME_MESSAGE
        : DUPLICATE_EMAIL_MESSAGE,
    };
  }
  if (!response.ok) {
    if (response.status >= 500) {
      await logServerError(new Error(`Auth request failed with status ${response.status}`), {
        pathname: "/api/auth/signup",
      });
    }
    return { ok: false, message: SIGNUP_FAILED_MESSAGE };
  }

  return { ok: true, message: "회원가입이 완료됐어요. 로그인해주세요." };
}

export async function signIn(formData: FormData): Promise<AuthActionState> {
  const parsed = parseSignInForm(formData);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  const { cookie, url } = await getSameOriginAuthRequest("/api/auth/login");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      credentials: "include",
      body: JSON.stringify(parsed.data),
    });
    if (response.ok) await applySessionCookie(response);
  } catch (error) {
    await logServerError(error, { pathname: "/api/auth/login" });
    return { ok: false, message: LOGIN_FAILED_MESSAGE };
  }

  if (response.status === 401) return { ok: false, message: INVALID_CREDENTIALS_MESSAGE };
  if (!response.ok) {
    if (response.status >= 500) {
      await logServerError(new Error(`Auth request failed with status ${response.status}`), {
        pathname: "/api/auth/login",
      });
    }
    return { ok: false, message: LOGIN_FAILED_MESSAGE };
  }

  return { ok: true, message: "로그인했어요." };
}

export async function signOut() {
  const { cookie, url } = await getSameOriginAuthRequest("/api/auth/logout");
  try {
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      ...(cookie ? { headers: { Cookie: cookie } } : {}),
    });
    if (!response.ok) throw new Error(`Auth request failed with status ${response.status}`);
    await applySessionCookie(response);
  } catch (error) {
    await logServerError(error, { pathname: "/api/auth/logout" });
    throw new Error("로그아웃하지 못했어요. 잠시 후 다시 시도해주세요.");
  }
}
