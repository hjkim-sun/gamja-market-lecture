import { redirect } from "next/navigation";
import ChatThread from "@/features/chats/components/ChatThread";
import { getChatThreadById } from "@/features/chats/data/chats-api";

export const metadata = {
  title: "채팅 — 감자마켓",
};

export default async function ChatThreadPage(props: PageProps<"/chats/[id]">) {
  const { id } = await props.params;
  const result = await getChatThreadById(id);

  if (!result.ok) {
    redirect(result.status === 401 ? `/login?next=/chats/${id}` : "/chats");
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <ChatThread thread={result.thread} />
    </div>
  );
}
