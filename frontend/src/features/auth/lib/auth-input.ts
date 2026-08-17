export const APP_ROLES = ["buyer", "seller"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export type AuthCredentials = {
  email: string;
  password: string;
};

export type SignUpInput = AuthCredentials & {
  passwordConfirmation: string;
  displayName: string;
};

export type InputResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DISPLAY_NAME_MAX_LENGTH = 40;

function requiredText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function rawText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
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

export function parseSignUpForm(formData: FormData): InputResult<SignUpInput> {
  const credentials = parseCredentials(formData);
  if (!credentials.ok) return credentials;

  const displayName = requiredText(formData.get("displayName"));
  if (displayName.length < 1 || displayName.length > DISPLAY_NAME_MAX_LENGTH) {
    return { ok: false, message: "표시 이름은 1자 이상 40자 이하로 입력해 주세요." };
  }

  const passwordConfirmation = rawText(formData.get("passwordConfirmation"));
  if (passwordConfirmation !== credentials.data.password) {
    return { ok: false, message: "비밀번호가 일치하지 않아요." };
  }

  return {
    ok: true,
    data: { ...credentials.data, passwordConfirmation, displayName },
  };
}

export function parseSignInForm(formData: FormData): InputResult<AuthCredentials> {
  return parseCredentials(formData);
}

/** Accept only internal absolute paths to prevent callback open redirects. */
export function safeNextPath(value: string | null, fallback = "/") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}
