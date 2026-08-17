"use client";

import { useState } from "react";
import Link from "next/link";
import { applyToRequest } from "@/features/applications/actions/applications";
import {
  parseApplicationForm,
  type ApplicationFormErrors,
} from "@/features/applications/lib/application-input";

export default function ApplyForm({ requestId }: { requestId: string }) {
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ApplicationFormErrors>({});
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    const parsed = parseApplicationForm(formData);
    if (!parsed.ok) {
      setError("");
      setFieldErrors(parsed.errors);
      return;
    }

    setFieldErrors({});
    setError("");
    setPending(true);
    try {
      const result = await applyToRequest(requestId, formData);
      if (!result.ok) {
        setFieldErrors(result.errors ?? {});
        setError(result.message ?? "");
        setBlocked(Boolean(result.blocked));
      }
    } catch {
      setError("지원을 등록하지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setPending(false);
    }
  }

  if (blocked) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
        <Link
          href={`/requests/${requestId}`}
          className="text-sm font-semibold text-[#d9822b] hover:underline"
        >
          ← 요청으로 돌아가기
        </Link>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="offeredPrice" className="text-sm font-semibold text-[#4a2f1c]">
          제안 가격 (원)
        </label>
        <input
          id="offeredPrice"
          name="offeredPrice"
          type="number"
          min={1}
          max={100_000_000}
          step={1}
          disabled={pending}
          placeholder="예: 700000"
          aria-invalid={Boolean(fieldErrors.offeredPrice)}
          className="rounded-xl border border-amber-200 px-4 py-2.5 text-sm text-[#4a2f1c] outline-none focus:border-[#d9822b] focus:ring-2 focus:ring-[#d9822b]/30"
        />
        {fieldErrors.offeredPrice && (
          <p className="text-xs text-red-600">{fieldErrors.offeredPrice}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="message" className="text-sm font-semibold text-[#4a2f1c]">
          지원 메시지
        </label>
        <textarea
          id="message"
          name="message"
          rows={5}
          disabled={pending}
          placeholder="재고 여부, 거래 가능 시간 등을 알려주세요."
          aria-invalid={Boolean(fieldErrors.message)}
          className="rounded-xl border border-amber-200 px-4 py-2.5 text-sm text-[#4a2f1c] outline-none focus:border-[#d9822b] focus:ring-2 focus:ring-[#d9822b]/30"
        />
        {fieldErrors.message && <p className="text-xs text-red-600">{fieldErrors.message}</p>}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-full bg-[#d9822b] px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#c46f1d] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "지원하는 중…" : "지원하기"}
      </button>
    </form>
  );
}
