import { redirect } from "next/navigation";
import ApplyForm from "@/features/applications/components/ApplyForm";
import { getSameOriginRequest } from "@/lib/api/same-origin-request";

export const metadata = {
  title: "판매자 지원 — 감자마켓",
};

async function isAuthenticated() {
  const { cookie, url } = await getSameOriginRequest("/api/auth/me");
  try {
    const response = await fetch(url, {
      ...(cookie ? { headers: { Cookie: cookie } } : {}),
      credentials: "include",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export default async function RequestApplyPage(
  props: PageProps<"/requests/[id]/apply">,
) {
  const { id } = await props.params;

  if (!(await isAuthenticated())) {
    redirect(`/login?next=/requests/${id}/apply`);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-extrabold text-[#4a2f1c] sm:text-3xl">
        이 요청에 지원하기
      </h1>
      <p className="mt-2 text-sm text-[#8a6a4a]">
        제안 가격과 메시지를 남기면 요청 작성자가 확인 후 수락 여부를 결정해요.
      </p>
      <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-amber-200/60 sm:p-8">
        <ApplyForm requestId={id} />
      </div>
    </div>
  );
}
