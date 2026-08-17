import LoginForm from "@/features/auth/components/LoginForm";

export const metadata = { title: "로그인 — 감자마켓" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const requestedNext = typeof params.next === "string" ? params.next : "/";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") && requestedNext !== "/login" ? requestedNext : "/";
  return <LoginForm next={next} />;
}
