import Link from "next/link";
import type { ChatThreadSummary } from "@/types/chat";

function formatLastActivity(thread: ChatThreadSummary) {
  return thread.lastMessageAt ?? "";
}

export default function ChatThreadList({ threads }: { threads: ChatThreadSummary[] }) {
  if (threads.length === 0) {
    return (
      <p className="rounded-2xl bg-white p-6 text-center text-sm text-[#8a6a4a] shadow-sm ring-1 ring-amber-200/60">
        아직 진행 중인 채팅이 없어요.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {threads.map((thread) => (
        <li key={thread.id}>
          <Link
            href={`/chats/${thread.id}`}
            className="block rounded-2xl bg-white p-5 shadow-sm ring-1 ring-amber-200/60 transition hover:ring-[#d9822b]"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-[#4a2f1c]">
                {thread.counterpartDisplayName}
              </span>
              {thread.lastMessageAt && (
                <span className="text-xs text-[#b89a7c]">{formatLastActivity(thread)}</span>
              )}
            </div>
            <p className="mt-1 text-sm text-[#8a6a4a]">{thread.requestTitle}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
