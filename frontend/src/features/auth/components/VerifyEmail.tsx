"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AuthField from "@/features/auth/components/AuthField";
import AuthShell from "@/features/auth/components/AuthShell";
import AuthSubmitButton from "@/features/auth/components/AuthSubmitButton";
import FormAlert from "@/features/auth/components/FormAlert";
import { createClient } from "@/lib/supabase/client";

type ResendState = "idle" | "pending" | "success" | "rate-limited" | "error";

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "";
  return `${local.slice(0, 1)}***@${domain}`;
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function VerifyEmail() {
  const [email, setEmail] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [resendState, setResendState] = useState<ResendState>("idle");
  const [emailError, setEmailError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setEmail(sessionStorage.getItem("gm-verify-email")), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function resend(targetEmail: string) {
    if (!isValidEmail(targetEmail)) {
      setEmailError("이메일 주소를 확인해주세요.");
      return;
    }
    setEmailError("");
    setResendState("pending");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: targetEmail,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/` },
      });
      if (error) {
        const message = error.message.toLowerCase();
        setResendState(message.includes("rate") || message.includes("too many") ? "rate-limited" : "error");
        return;
      }
      sessionStorage.setItem("gm-verify-email", targetEmail);
      setEmail(targetEmail);
      setResendState("success");
    } catch {
      setResendState("error");
    }
  }

  if (email === null) {
    return (
      <AuthShell title="인증 메일 다시 받기" description="인증 메일을 받을 이메일을 입력해주세요.">
        {resendState === "success" && <FormAlert tone="success">인증 메일을 보냈어요. 받은메일함을 확인해주세요.</FormAlert>}
        {resendState === "rate-limited" && <FormAlert tone="error">잠시 후 다시 보낼 수 있어요. 메일함을 먼저 확인해주세요.</FormAlert>}
        {resendState === "error" && <FormAlert tone="error">인증 메일을 다시 보내지 못했어요. 잠시 후 다시 시도해주세요.</FormAlert>}
        <form className="gm-auth-form" onSubmit={(event) => { event.preventDefault(); void resend(emailInput.trim()); }} noValidate>
          <AuthField name="email" label="인증 메일을 다시 받을 이메일" placeholder="name@example.com" error={emailError} disabled={resendState === "pending"} autoComplete="email" value={emailInput} onChange={(event) => setEmailInput(event.target.value)} />
          <AuthSubmitButton idleLabel="인증 메일 보내기" pendingLabel="인증 메일 다시 보내는 중…" pending={resendState === "pending"} />
        </form>
        <p className="gm-auth-link"><Link href="/login">로그인으로 돌아가기</Link></p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="인증 메일을 보냈어요" description={`${maskEmail(email)}으로 보낸 메일에서 인증 링크를 눌러주세요.`}>
      <div className="gm-mail-badge" aria-hidden="true">✉</div>
      <ul className="gm-check-list">
        <li>메일이 보이지 않나요? 스팸함도 확인해보세요.</li>
        <li>인증 링크는 보안을 위해 일정 시간이 지나면 만료될 수 있어요.</li>
      </ul>
      <div className="gm-alert-stack" aria-live="polite">
        {resendState === "success" && <FormAlert tone="success">새 인증 메일을 보냈어요. 받은메일함을 다시 확인해주세요.</FormAlert>}
        {resendState === "rate-limited" && <FormAlert tone="error">잠시 후 다시 보낼 수 있어요. 메일함을 먼저 확인해주세요.</FormAlert>}
        {resendState === "error" && <FormAlert tone="error">인증 메일을 다시 보내지 못했어요. 잠시 후 다시 시도해주세요.</FormAlert>}
      </div>
      <button type="button" className="gm-secondary-button" disabled={resendState === "pending" || resendState === "rate-limited"} onClick={() => void resend(email)}>
        {resendState === "pending" && <span className="gm-spinner gm-spinner-dark" aria-hidden="true" />}
        {resendState === "pending" ? "인증 메일 다시 보내는 중…" : "인증 메일 다시 보내기"}
      </button>
      <p className="gm-auth-link"><Link href="/login">로그인으로 돌아가기</Link></p>
    </AuthShell>
  );
}
