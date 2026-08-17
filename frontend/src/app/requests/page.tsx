import Link from "next/link";
import StatusBadge from "@/features/requests/components/StatusBadge";
import { mockRequests } from "@/features/requests/data/mock-requests";

export const metadata = {
  title: "구매요청 목록 — 감자마켓",
};

export default function RequestsPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold text-[#4a2f1c] sm:text-3xl">
          구매요청 목록
        </h1>
        <p className="mt-2 text-sm text-[#8a6a4a]">
          지금 감자마켓에 올라와 있는 구매요청이에요. 마음에 드는 요청을
          눌러 자세히 확인해보세요.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {mockRequests.map((request) => (
          <Link
            key={request.id}
            href={`/requests/${request.id}`}
            className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-amber-200/60 transition hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-600">
                {request.category}
              </span>
              <StatusBadge status={request.status} />
            </div>
            <h2 className="line-clamp-2 font-bold text-[#4a2f1c]">
              {request.title}
            </h2>
            <p className="text-lg font-extrabold text-[#d9822b]">
              {request.desiredPrice.toLocaleString()}원
            </p>
            <p className="text-xs text-[#b89a7c]">{request.createdAt} 등록</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
