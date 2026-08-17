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

  if (result.requests.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-extrabold text-[#4a2f1c] sm:text-3xl">내 구매요청</h1>
        <div className="mt-8 rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-amber-200/60">
          <p className="text-sm text-[#8a6a4a]">아직 등록한 구매요청이 없어요.</p>
          <Link href="/requests/new" className="mt-4 inline-block text-sm font-semibold text-[#d9822b] hover:underline">첫 요청을 등록해보세요</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-extrabold text-[#4a2f1c] sm:text-3xl">내 구매요청</h1>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {result.requests.map((request) => (
          <article key={request.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-amber-200/60">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-amber-600">{request.category}</span>
              <StatusBadge status={request.status} />
            </div>
            <Link href={`/requests/${request.id}`} className="mt-3 block text-lg font-extrabold text-[#4a2f1c] hover:underline">{request.title}</Link>
            <p className="mt-2 text-xl font-extrabold text-[#d9822b]">{request.desiredPrice.toLocaleString()}원</p>
            <p className="mt-2 text-xs text-[#b89a7c]">{request.createdAt} 등록</p>
            {request.applicationCount === 0 ? (
              <p className="mt-4 text-sm font-semibold text-[#6b5540]">현재 지원자 수: 0명</p>
            ) : (
              <Link href={`/requests/${request.id}/applications`} className="mt-4 inline-block text-sm font-semibold text-[#d9822b] hover:underline">
                현재 지원자 수: {request.applicationCount}명
              </Link>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
