"use client";

import { useState } from "react";
import { createRequest } from "@/features/requests/actions/requests";
import {
  REQUEST_CATEGORIES,
  parseRequestForm,
  type RequestFormErrors,
} from "@/features/requests/lib/request-input";

export default function RequestForm() {
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<RequestFormErrors>({});
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    const parsed = parseRequestForm(formData);
    if (!parsed.ok) {
      setError("");
      setFieldErrors(parsed.errors);
      return;
    }

    setFieldErrors({});
    setError("");
    setPending(true);
    try {
      const result = await createRequest(formData);
      if (!result.ok) {
        setFieldErrors(result.errors ?? {});
        setError(result.message ?? "");
      }
    } catch {
      setError("구매요청을 등록하지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="title" className="text-sm font-semibold text-[#4a2f1c]">
          제목
        </label>
        <input
          id="title"
          name="title"
          type="text"
          disabled={pending}
          placeholder="예: 아이폰 14 프로 128GB 자급제"
          aria-invalid={Boolean(fieldErrors.title)}
          className="rounded-xl border border-amber-200 px-4 py-2.5 text-sm text-[#4a2f1c] outline-none focus:border-[#d9822b] focus:ring-2 focus:ring-[#d9822b]/30"
        />
        {fieldErrors.title && <p className="text-xs text-red-600">{fieldErrors.title}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="category" className="text-sm font-semibold text-[#4a2f1c]">
          카테고리
        </label>
        <select
          id="category"
          name="category"
          disabled={pending}
          defaultValue=""
          aria-invalid={Boolean(fieldErrors.category)}
          className="rounded-xl border border-amber-200 bg-white px-4 py-2.5 text-sm text-[#4a2f1c] outline-none focus:border-[#d9822b] focus:ring-2 focus:ring-[#d9822b]/30"
        >
          <option value="" disabled>
            카테고리를 선택해주세요
          </option>
          {REQUEST_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        {fieldErrors.category && <p className="text-xs text-red-600">{fieldErrors.category}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="desiredPrice" className="text-sm font-semibold text-[#4a2f1c]">
          희망 가격 (원)
        </label>
        <input
          id="desiredPrice"
          name="desiredPrice"
          type="number"
          min={1}
          max={100_000_000}
          step={1}
          disabled={pending}
          placeholder="예: 750000"
          aria-invalid={Boolean(fieldErrors.desiredPrice)}
          className="rounded-xl border border-amber-200 px-4 py-2.5 text-sm text-[#4a2f1c] outline-none focus:border-[#d9822b] focus:ring-2 focus:ring-[#d9822b]/30"
        />
        {fieldErrors.desiredPrice && (
          <p className="text-xs text-red-600">{fieldErrors.desiredPrice}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="description" className="text-sm font-semibold text-[#4a2f1c]">
          상세 설명
        </label>
        <textarea
          id="description"
          name="description"
          rows={5}
          disabled={pending}
          placeholder="원하는 상태, 색상, 거래 방식 등을 알려주세요."
          aria-invalid={Boolean(fieldErrors.description)}
          className="rounded-xl border border-amber-200 px-4 py-2.5 text-sm text-[#4a2f1c] outline-none focus:border-[#d9822b] focus:ring-2 focus:ring-[#d9822b]/30"
        />
        {fieldErrors.description && (
          <p className="text-xs text-red-600">{fieldErrors.description}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-full bg-[#d9822b] px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#c46f1d] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "등록하는 중…" : "구매요청 등록"}
      </button>
    </form>
  );
}
