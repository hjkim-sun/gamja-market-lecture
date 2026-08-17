export const APP_ROLES = ["buyer", "seller"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export type AuthCredentials = {
  email: string;
  password: string;
};

export type InputResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requiredText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function parseCredentials(formData: FormData): InputResult<AuthCredentials> {
  const email = requiredText(formData.get("email")).toLowerCase();
  const password = typeof formData.get("password") === "string" ? String(formData.get("password")) : "";

  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, message: "유효한 이메일 주소를 입력해 주세요." };
  }

  if (password.length < 8) {
    return { ok: false, message: "비밀번호는 8자 이상이어야 해요." };
  }

  return { ok: true, data: { email, password } };
}

export function parseSignUpForm(formData: FormData): InputResult<AuthCredentials> {
  return parseCredentials(formData);
}

export function parseSignInForm(formData: FormData): InputResult<AuthCredentials> {
  return parseCredentials(formData);
}

/** Accept only internal absolute paths to prevent callback open redirects. */
export function safeNextPath(value: string | null, fallback = "/") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}
