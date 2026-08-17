"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signUp } from "@/features/auth/actions/auth";
import AuthField from "@/features/auth/components/AuthField";
import AuthShell from "@/features/auth/components/AuthShell";
import AuthSubmitButton from "@/features/auth/components/AuthSubmitButton";
import FormAlert from "@/features/auth/components/FormAlert";

type FieldErrors = Partial<Record<"email" | "password", string>>;

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function SignUpForm() {
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const validationMessage = fieldErrors.email || fieldErrors.password;

  function clearFieldError(field: keyof FieldErrors) {
    setFieldErrors((current) => {
      if (!current[field]) return current;

      const remaining = { ...current };
      delete remaining[field];
      return remaining;
    });
  }

  function focusFirstError(errors: FieldErrors) {
    const target = errors.email ? emailRef.current : passwordRef.current;
    target?.focus();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const errors: FieldErrors = {};

    if (!isValidEmail(email)) errors.email = "이메일 주소를 확인해주세요.";
    if (password.length < 8) errors.password = "비밀번호는 8자 이상 입력해주세요.";

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
        <AuthSubmitButton idleLabel="회원가입" pendingLabel="가입하는 중…" pending={pending} />
      </form>
      <p className="gm-auth-link">이미 계정이 있나요? <Link href="/login">로그인</Link></p>
    </AuthShell>
  );
}
