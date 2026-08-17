"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/features/auth/actions/auth";
import AuthField from "@/features/auth/components/AuthField";
import AuthShell from "@/features/auth/components/AuthShell";
import AuthSubmitButton from "@/features/auth/components/AuthSubmitButton";
import FormAlert from "@/features/auth/components/FormAlert";

type LoginFormProps = { next: string };
type FieldErrors = Partial<Record<"email" | "password", string>>;

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function LoginForm({ next }: LoginFormProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const errors: FieldErrors = {};
    if (!isValidEmail(email)) errors.email = "이메일 주소를 확인해주세요.";
    if (!password) errors.password = "비밀번호를 입력해주세요.";
    if (Object.keys(errors).length) {
      setError("");
      setFieldErrors(errors);
      requestAnimationFrame(() => (errors.email ? emailRef.current : passwordRef.current)?.focus());
      return;
    }

    setFieldErrors({});
    setError("");
    setPending(true);
    try {
      const result = await signIn(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError("로그인하지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell title="다시 만났네요" description="이메일과 비밀번호로 로그인해주세요.">
      {error && <FormAlert tone="error">{error}</FormAlert>}
      <form className="gm-auth-form" onSubmit={submit} noValidate>
        <AuthField name="email" label="이메일" placeholder="name@example.com" error={fieldErrors.email} disabled={pending} autoComplete="email" inputRef={emailRef} />
        <AuthField name="password" label="비밀번호" type="password" placeholder="비밀번호 입력" error={fieldErrors.password} disabled={pending} autoComplete="current-password" inputRef={passwordRef} />
        <AuthSubmitButton idleLabel="로그인" pendingLabel="로그인하는 중…" pending={pending} />
      </form>
      <p className="gm-auth-link">아직 계정이 없나요? <Link href="/signup">회원가입</Link></p>
    </AuthShell>
  );
}
