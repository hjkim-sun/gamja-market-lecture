import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import StatusBadge from "@/features/requests/components/StatusBadge";
import { getRequestById } from "@/features/requests/data/requests-api";
import type { PurchaseRequest } from "@/types/request";

export async function generateMetadata(props: PageProps<"/requests/[id]">) {
  const { id } = await props.params;
  const request = await getRequestById(id);
  return {
    title: request ? `${request.title} — 감자마켓` : "구매요청을 찾을 수 없어요 — 감자마켓",
  };
}

const CTA_BUTTON_CLASS =
  "mt-8 block w-full rounded-full bg-[#d9822b] px-6 py-3 text-center text-sm font-bold text-white shadow-sm transition hover:bg-[#c46f1d] sm:text-base";
const DISABLED_BUTTON_CLASS =
  "mt-8 w-full cursor-not-allowed rounded-full bg-amber-400/60 px-6 py-3 text-sm font-bold text-[#6b3f1d]/70 sm:text-base";
const SECONDARY_LINK_CLASS =
  "mt-3 block w-full rounded-full border border-[#d9822b] px-6 py-3 text-center text-sm font-bold text-[#d9822b] transition hover:bg-amber-50 sm:text-base";

/** Renders the owner/applicant-specific action panel described in docs/specs/11 §5.1. */
function ApplicationAction({ request }: { request: PurchaseRequest }): ReactNode {
  if (request.isOwner) {
    if (request.status === "모집중") {
      const applicationCount = request.applicationCount;
      return (
        <>
          <button type="button" disabled className={DISABLED_BUTTON_CLASS}>
            내가 등록한 요청이에요
          </button>
          {applicationCount !== 0 && (
            <Link href={`/requests/${request.id}/applications`} className={SECONDARY_LINK_CLASS}>
              {typeof applicationCount === "number" ? `지원자 보기 (${applicationCount})` : "지원자 보기"}
            </Link>
          )}
        </>
      );
    }

    return (
      <>
        <p className="mt-8 text-center text-sm font-semibold text-[#6b5540]">
          매칭된 판매자와 대화 중이에요
        </p>
        <Link href={request.viewerChatThreadId ? `/chats/${request.viewerChatThreadId}` : "/chats"} className={CTA_BUTTON_CLASS}>
          채팅으로 이동
        </Link>
      </>
    );
  }

  const viewerApplicationStatus = request.viewerApplicationStatus;

  if (viewerApplicationStatus === undefined) {
    return (
      <button
        type="button"
        disabled
        title="로그인하면 이 요청에 지원할 수 있어요"
        className={DISABLED_BUTTON_CLASS}
      >
        이 요청에 지원하기
      </button>
    );
  }

  if (viewerApplicationStatus === "대기중") {
    return (
      <button type="button" disabled className={DISABLED_BUTTON_CLASS}>
        지원 완료 · 답변 대기중
      </button>
    );
  }

  if (viewerApplicationStatus === "거절됨") {
    return (
      <button type="button" disabled className={DISABLED_BUTTON_CLASS}>
        이 지원은 거절되었어요
      </button>
    );
  }

  if (viewerApplicationStatus === "수락됨") {
    return (
      <Link href={request.viewerChatThreadId ? `/chats/${request.viewerChatThreadId}` : "/chats"} className={CTA_BUTTON_CLASS}>
        채팅으로 이동
      </Link>
    );
  }

  if (request.status !== "모집중") {
    return (
      <button type="button" disabled className={DISABLED_BUTTON_CLASS}>
        이미 매칭이 완료된 요청이에요
      </button>
    );
  }

  return (
    <Link href={`/requests/${request.id}/apply`} className={CTA_BUTTON_CLASS}>
      이 요청에 지원하기
    </Link>
  );
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

        <ApplicationAction request={request} />
      </div>
    </div>
  );
}
