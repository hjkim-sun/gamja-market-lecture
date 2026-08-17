"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signUp } from "@/features/auth/actions/auth";
import AuthField from "@/features/auth/components/AuthField";
import AuthShell from "@/features/auth/components/AuthShell";
import AuthSubmitButton from "@/features/auth/components/AuthSubmitButton";
import FormAlert from "@/features/auth/components/FormAlert";

type FieldErrors = Partial<Record<"email" | "displayName" | "password" | "passwordConfirmation", string>>;

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function SignUpForm() {
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const displayNameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const passwordConfirmationRef = useRef<HTMLInputElement>(null);
  const validationMessage =
    fieldErrors.email || fieldErrors.displayName || fieldErrors.password || fieldErrors.passwordConfirmation;

  function clearFieldError(field: keyof FieldErrors) {
    setFieldErrors((current) => {
      if (!current[field]) return current;

      const remaining = { ...current };
      delete remaining[field];
      return remaining;
    });
  }

  function focusFirstError(errors: FieldErrors) {
    const target = errors.email
      ? emailRef.current
      : errors.displayName
        ? displayNameRef.current
        : errors.password
          ? passwordRef.current
          : passwordConfirmationRef.current;
    target?.focus();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const displayName = String(formData.get("displayName") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const passwordConfirmation = String(formData.get("passwordConfirmation") ?? "");
    const errors: FieldErrors = {};

    if (!isValidEmail(email)) errors.email = "이메일 주소를 확인해주세요.";
    if (displayName.length < 1 || displayName.length > 40) {
      errors.displayName = "익명 아이디는 1자 이상 40자 이하로 입력해주세요.";
    }
    if (password.length < 8) errors.password = "비밀번호는 8자 이상 입력해주세요.";
    if (!errors.password && passwordConfirmation !== password) {
      errors.passwordConfirmation = "비밀번호가 일치하지 않아요.";
    }

    if (Object.keys(errors).length) {
      setFormError("");
      setFieldErrors(errors);
      requestAnimationFrame(() => focusFirstError(errors));
      return;
    }

    setFieldErrors({});
    setFormError("");
    setPending(true);
    try {
      const result = await signUp(formData);
      if (!result.ok) {
        if (result.message === "이미 사용 중인 이메일이에요.") {
          const errors = { email: result.message };
          setFieldErrors(errors);
          requestAnimationFrame(() => focusFirstError(errors));
          return;
        }
        setFormError("가입을 완료하지 못했어요. 잠시 후 다시 시도해주세요.");
        return;
      }

      router.push("/login?signup=success");
    } catch {
      setFormError("연결이 원활하지 않아요. 인터넷 연결을 확인한 뒤 다시 시도해주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell title="감자마켓 시작하기" description="이메일과 비밀번호로 계정을 만들어보세요.">
      {formError && <FormAlert tone="error">{formError}</FormAlert>}
      {validationMessage && <FormAlert tone="error">입력한 내용을 다시 확인해주세요.</FormAlert>}
      <form className="gm-auth-form" onSubmit={submit} noValidate>
        <AuthField
          name="email"
          label="이메일"
          placeholder="name@example.com"
          helpText="로그인에 사용할 이메일이에요."
          error={fieldErrors.email}
          disabled={pending}
          autoComplete="email"
          inputRef={emailRef}
          onChange={() => clearFieldError("email")}
        />
        <AuthField
          name="displayName"
          label="익명 아이디"
          placeholder="예: 날아오르는 감자"
          helpText="다른 사용자에게 보여질 이름이에요. (1~40자)"
          error={fieldErrors.displayName}
          disabled={pending}
          autoComplete="nickname"
          inputRef={displayNameRef}
          onChange={() => clearFieldError("displayName")}
        />
        <AuthField
          name="password"
          label="비밀번호"
          type="password"
          placeholder="8자 이상 입력"
          helpText="8자 이상 입력해주세요."
          error={fieldErrors.password}
          disabled={pending}
          autoComplete="new-password"
          minLength={8}
          inputRef={passwordRef}
          onChange={() => clearFieldError("password")}
        />
        <AuthField
          name="passwordConfirmation"
          label="비밀번호 확인"
          type="password"
          placeholder="비밀번호를 다시 입력"
          helpText="비밀번호를 한 번 더 입력해주세요."
          error={fieldErrors.passwordConfirmation}
          disabled={pending}
          autoComplete="new-password"
          inputRef={passwordConfirmationRef}
          onChange={() => clearFieldError("passwordConfirmation")}
        />
        <AuthSubmitButton idleLabel="회원가입" pendingLabel="가입하는 중…" pending={pending} />
      </form>
      <p className="gm-auth-link">이미 계정이 있나요? <Link href="/login">로그인</Link></p>
    </AuthShell>
  );
}
