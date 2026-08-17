import Link from "next/link";
import { notFound } from "next/navigation";
import StatusBadge from "@/features/requests/components/StatusBadge";
import { getRequestById } from "@/features/requests/data/requests-api";

export async function generateMetadata(props: PageProps<"/requests/[id]">) {
  const { id } = await props.params;
  const request = await getRequestById(id);
  return {
    title: request ? `${request.title} — 감자마켓` : "구매요청을 찾을 수 없어요 — 감자마켓",
  };
}

export default async function RequestDetailPage(
  props: PageProps<"/requests/[id]">,
) {
  const { id } = await props.params;
  const request = await getRequestById(id);

  if (!request) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link
        href="/requests"
        className="text-sm font-semibold text-[#d9822b] hover:underline"
      >
        ← 목록으로
      </Link>

      <div className="mt-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-amber-200/60 sm:p-8">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-amber-600">
            {request.category}
          </span>
          <StatusBadge status={request.status} />
        </div>

        <h1 className="mt-2 text-2xl font-extrabold text-[#4a2f1c] sm:text-3xl">
          {request.title}
        </h1>
        <p className="mt-1 text-sm text-[#b89a7c]">{request.createdAt} 등록</p>

        <p className="mt-4 text-3xl font-extrabold text-[#d9822b]">
          {request.desiredPrice.toLocaleString()}원
        </p>

        <div className="mt-6 border-t border-amber-100 pt-6">
          <h2 className="mb-2 text-sm font-bold text-[#4a2f1c]">
            상세 설명
          </h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-[#6b5540]">
            {request.description}
          </p>
        </div>

        {request.isOwner ? (
          <button
            type="button"
            disabled
            className="mt-8 w-full cursor-not-allowed rounded-full bg-amber-400/60 px-6 py-3 text-sm font-bold text-[#6b3f1d]/70 sm:text-base"
          >
            내가 등록한 요청이에요
          </button>
        ) : (
          <button
            type="button"
            title="판매자 지원 기능은 이후 단계에서 열려요"
            className="mt-8 w-full cursor-not-allowed rounded-full bg-amber-400/60 px-6 py-3 text-sm font-bold text-[#6b3f1d]/70 sm:text-base"
          >
            이 요청에 지원하기
          </button>
        )}
      </div>
    </div>
  );
}
