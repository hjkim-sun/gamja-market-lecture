import { redirect } from "next/navigation";
import ApplicationList from "@/features/applications/components/ApplicationList";
import { getApplicationsForRequest } from "@/features/applications/data/applications-api";

export const metadata = {
  title: "지원자 목록 — 감자마켓",
};

export default async function RequestApplicationsPage(
  props: PageProps<"/requests/[id]/applications">,
) {
  const { id } = await props.params;
  const result = await getApplicationsForRequest(id);

  if (!result.ok) {
    redirect(`/requests/${id}`);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-extrabold text-[#4a2f1c] sm:text-3xl">
        지원자 목록
      </h1>
      <p className="mt-2 text-sm text-[#8a6a4a]">
        지원자를 확인하고 함께 거래할 판매자를 수락해주세요.
      </p>
      <div className="mt-8">
        <ApplicationList applications={result.applications} requestId={id} />
      </div>
    </div>
  );
}
