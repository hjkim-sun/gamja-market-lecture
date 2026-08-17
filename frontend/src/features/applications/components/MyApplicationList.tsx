import Link from "next/link";
import type { ApplicationStatus, MyApplication } from "@/types/application";

const STATUS_STYLES: Record<ApplicationStatus, string> = {
  대기중: "bg-amber-100 text-amber-700",
  수락됨: "bg-emerald-100 text-emerald-700",
  거절됨: "bg-stone-200 text-stone-500",
};

/** Read-only view of the signed-in seller's own applications. No accept/reject actions. */
export default function MyApplicationList({ applications }: { applications: MyApplication[] }) {
  if (applications.length === 0) {
    return (
      <p className="rounded-2xl bg-white p-6 text-center text-sm text-[#8a6a4a] shadow-sm ring-1 ring-amber-200/60">
        아직 판매 신청한 구매요청이 없어요.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {applications.map((application) => (
        <li
          key={application.id}
          className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-amber-200/60"
        >
          <div className="flex items-center justify-between">
            <Link
              href={`/requests/${application.requestId}`}
              className="text-sm font-bold text-[#4a2f1c] hover:underline"
            >
              {application.requestTitle}
            </Link>
            <span
              className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[application.status]}`}
            >
              {application.status}
            </span>
          </div>
          <p className="mt-1 text-lg font-extrabold text-[#d9822b]">
            {application.offeredPrice.toLocaleString()}원
          </p>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[#6b5540]">
            {application.message}
          </p>
          <p className="mt-2 text-xs text-[#b89a7c]">{application.createdAt} 지원</p>

          {application.images && application.images.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
              {application.images.map((image) => (
                <a key={image.id} href={image.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed Supabase URL, not a static next/image asset */}
                  <img
                    src={image.url}
                    alt=""
                    className="aspect-square w-full rounded-lg object-cover"
                  />
                </a>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
