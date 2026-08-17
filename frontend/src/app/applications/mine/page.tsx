import { redirect } from "next/navigation";
import MyApplicationList from "@/features/applications/components/MyApplicationList";
import { getMyApplications } from "@/features/applications/data/applications-api";

export const metadata = {
  title: "내 판매 신청 — 감자마켓",
};

export default async function MyApplicationsPage() {
  const result = await getMyApplications();

  if (!result.ok) {
    redirect("/login?next=/applications/mine");
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-extrabold text-[#4a2f1c] sm:text-3xl">내 판매 신청</h1>
      <p className="mt-2 text-sm text-[#8a6a4a]">
        내가 지원한 구매요청과 진행 상태를 확인할 수 있어요.
      </p>
      <div className="mt-8">
        <MyApplicationList applications={result.applications} />
      </div>
    </div>
  );
}
