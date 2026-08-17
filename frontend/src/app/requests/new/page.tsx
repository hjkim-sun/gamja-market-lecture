import { redirect } from "next/navigation";
import RequestForm from "@/features/requests/components/RequestForm";
import { getSameOriginRequest } from "@/features/requests/lib/same-origin";

export const metadata = {
  title: "구매요청 등록 — 감자마켓",
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

export default async function RequestCreatePage() {
  if (!(await isAuthenticated())) {
    redirect("/login?next=/requests/new");
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-extrabold text-[#4a2f1c] sm:text-3xl">
        구매요청 등록
      </h1>
      <p className="mt-2 text-sm text-[#8a6a4a]">
        어떤 물건을 구매하고 싶은지 알려주세요. 등록하면 바로 목록에 노출돼요.
      </p>
      <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-amber-200/60 sm:p-8">
        <RequestForm />
      </div>
    </div>
  );
}
