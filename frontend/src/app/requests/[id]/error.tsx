"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";

/**
 * Load-error boundary for /requests/[id]. Renders when `getRequestById` throws (non-404
 * response or network failure) instead of returning `null`, so the not-found UI is reserved
 * for confirmed absence. See docs/specs/11.
 */
export default function RequestDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-20 text-center">
      <Image
        src="/gamja-mascot.png"
        alt="당황한 감자마켓 마스코트"
        width={140}
        height={140}
        className="h-32 w-32 object-contain opacity-90"
      />
      <h1 className="text-xl font-extrabold text-[#4a2f1c]">
        구매요청을 불러오지 못했어요
      </h1>
      <p className="text-sm text-[#8a6a4a]">잠시 후 다시 시도해 주세요.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded-full bg-[#d9822b] px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#c47523]"
      >
        다시 시도하기
      </button>
      <Link
        href="/requests"
        className="text-sm font-semibold text-[#d9822b] hover:underline"
      >
        구매요청 목록으로 가기
      </Link>
    </div>
  );
}
