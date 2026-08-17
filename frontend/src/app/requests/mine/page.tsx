import Link from "next/link";
import { redirect } from "next/navigation";
import StatusBadge from "@/features/requests/components/StatusBadge";
import { getMyRequests } from "@/features/requests/data/requests-api";

export const metadata = {
  title: "내 구매요청 — 감자마켓",
};

export default async function MyRequestsPage() {
  const result = await getMyRequests();

  if (!result.ok) {
    redirect("/login?next=/requests/mine");
    return null;
  }

  const requests = result.requests;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-[#4a2f1c] sm:text-3xl">내 구매요청</h1>
          <p className="mt-2 text-sm text-[#8a6a4a]">
            내가 등록한 구매요청과 진행 상태를 확인할 수 있어요.
          </p>
        </div>
        <Link
          href="/requests/new"
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#d9822b] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#c46f1d]"
        >
          구매요청 등록
        </Link>
      </div>

      {requests.length === 0 ? (
        <div className="rounded-2xl bg-white p-10 text-center shadow-sm ring-1 ring-amber-200/60">
          <p className="text-sm text-[#8a6a4a]">아직 등록한 구매요청이 없어요</p>
          <Link
            href="/requests/new"
            className="mt-4 inline-flex items-center justify-center rounded-full bg-[#d9822b] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#c46f1d]"
          >
            구매요청 등록하기
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {requests.map((request) => (
            <article
              key={request.id}
              className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-amber-200/60"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-600">{request.category}</span>
                <StatusBadge status={request.status} />
              </div>
              <Link
                href={`/requests/${request.id}`}
                className="line-clamp-2 font-bold text-[#4a2f1c] hover:underline"
              >
                {request.title}
              </Link>
              <p className="text-lg font-extrabold text-[#d9822b]">
                {request.desiredPrice.toLocaleString()}원
              </p>
              <p className="text-xs text-[#b89a7c]">{request.createdAt} 등록</p>
              {request.applicationCount === 0 ? (
                <p className="text-sm font-semibold text-[#6b5540]">현재 지원자 수: 0명</p>
              ) : (
                <Link
                  href={`/requests/${request.id}/applications`}
                  className="text-sm font-semibold text-[#d9822b] hover:underline"
                >
                  현재 지원자 수: {request.applicationCount}명
                </Link>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
