"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { decideApplication } from "@/features/applications/actions/applications";
import type { ApplicationStatus, OwnerApplication } from "@/types/application";

const STATUS_STYLES: Record<ApplicationStatus, string> = {
  대기중: "bg-amber-100 text-amber-700",
  수락됨: "bg-emerald-100 text-emerald-700",
  거절됨: "bg-stone-200 text-stone-500",
};

export default function ApplicationList({
  applications,
  requestId,
}: {
  applications: OwnerApplication[];
  requestId: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState(applications);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  async function decide(id: string, decision: "accept" | "reject") {
    setPendingId(id);
    setErrorById((current) => ({ ...current, [id]: "" }));
    try {
      const result = await decideApplication(id, decision);
      if (!result.ok) {
        setErrorById((current) => ({ ...current, [id]: result.message }));
        if (result.alreadyDecided) router.refresh();
        return;
      }

      if (decision === "accept" && result.result.chatThreadId) {
        router.push(`/chats/${result.result.chatThreadId}`);
        return;
      }

      setItems((current) =>
        current.map((item) =>
          item.id === id ? { ...item, status: result.result.application.status } : item,
        ),
      );
    } finally {
      setPendingId(null);
    }
  }

  if (items.length === 0) {
    return (
      <p className="rounded-2xl bg-white p-6 text-center text-sm text-[#8a6a4a] shadow-sm ring-1 ring-amber-200/60">
        아직 지원한 판매자가 없어요.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-4" data-request-id={requestId}>
      {items.map((application) => (
        <li
          key={application.id}
          className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-amber-200/60"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-[#4a2f1c]">
              {application.sellerDisplayName}
            </span>
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

          {errorById[application.id] && (
            <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-2 text-xs text-red-700">
              {errorById[application.id]}
            </p>
          )}

          {application.status === "대기중" && (
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={pendingId === application.id}
                onClick={() => decide(application.id, "accept")}
                className="flex-1 rounded-full bg-[#d9822b] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#c46f1d] disabled:cursor-not-allowed disabled:opacity-60"
              >
                수락
              </button>
              <button
                type="button"
                disabled={pendingId === application.id}
                onClick={() => decide(application.id, "reject")}
                className="flex-1 rounded-full border border-amber-300 px-4 py-2 text-sm font-bold text-[#8a6a4a] transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                거절
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
