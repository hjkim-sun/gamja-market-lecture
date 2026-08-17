import Link from "next/link";
import AuthShell from "@/features/auth/components/AuthShell";

export const metadata = { title: "이메일 인증 완료 — 감자마켓" };

export type VerificationStatus = "verified" | "invalid-link" | "failed";

/**
 * Treat only callback statuses we explicitly support as trusted. A missing or
 * malformed value must never make a failed verification look successful.
 */
export function resolveVerificationStatus(
  status: string | string[] | undefined,
): VerificationStatus {
  if (status === "verified" || status === "invalid-link" || status === "failed") {
    return status;
  }

  return "failed";
}

export default async function EmailVerifiedPage({ searchParams }: PageProps<"/email-verified">) {
  const params = await searchParams;
  const status = resolveVerificationStatus(params.status);
  const invalid = status === "invalid-link";
  const failed = status === "failed";

  if (invalid || failed) {
    const title = invalid ? "인증 링크를 확인해주세요" : "이메일 인증을 완료하지 못했어요";
    const description = invalid
      ? "인증 링크가 만료되었거나 이미 사용되었어요. 새 인증 메일을 보내드릴게요."
      : "잠시 후 다시 시도하거나 인증 메일을 다시 보내주세요.";
    return (
      <AuthShell title={title} description={description}>
        <Link className="gm-primary-button gm-button-link" href="/verify-email">인증 메일 다시 보내기</Link>
        {failed && <p className="gm-auth-link"><Link href="/login">로그인으로 돌아가기</Link></p>}
      </AuthShell>
    );
  }

  return (
    <AuthShell title="이메일 인증이 완료됐어요" description="이제 감자마켓에 로그인해 거래를 시작해보세요.">
      <div className="gm-verified-mark" aria-hidden="true">✓</div>
      <Link className="gm-primary-button gm-button-link" href="/login">로그인하기</Link>
    </AuthShell>
  );
}
