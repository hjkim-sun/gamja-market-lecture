import { redirect } from "next/navigation";
import ChatThreadList from "@/features/chats/components/ChatThreadList";
import { getMyChatThreads } from "@/features/chats/data/chats-api";

export const metadata = {
  title: "채팅 — 감자마켓",
};

export default async function ChatsPage() {
  const result = await getMyChatThreads();

  if (!result.ok) {
    redirect("/login?next=/chats");
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-extrabold text-[#4a2f1c] sm:text-3xl">채팅</h1>
      <p className="mt-2 text-sm text-[#8a6a4a]">
        매칭된 판매자·구매자와 나눈 대화 목록이에요.
      </p>
      <div className="mt-8">
        <ChatThreadList threads={result.threads} />
      </div>
    </div>
  );
}
