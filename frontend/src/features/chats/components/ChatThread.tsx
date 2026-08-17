"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { sendChatMessage } from "@/features/chats/actions/chats";
import type { ChatMessage, ChatThreadDetail } from "@/types/chat";

const POLL_INTERVAL_MS = 4000;

export default function ChatThread({ thread }: { thread: ChatThreadDetail }) {
  const [messages, setMessages] = useState<ChatMessage[]>(thread.messages);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetch(`/api/chats/${thread.id}`, { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const next = (await response.json()) as ChatThreadDetail;
        if (!cancelled) setMessages(next.messages);
      } catch {
        // Polling failures are silent; the next tick retries.
      }
    };

    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [thread.id]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const body = String(formData.get("body") ?? "").trim();
    if (!body) return;

    setPending(true);
    setError("");
    try {
      const result = await sendChatMessage(thread.id, body);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessages((current) => [...current, result.message]);
      formRef.current?.reset();
    } finally {
      setPending(false);
    }
  }

  return (
    <div data-viewer-id={thread.viewerId} className="flex flex-col">
      <Link href="/chats" className="text-sm font-semibold text-[#d9822b] hover:underline">
        ← 채팅 목록으로
      </Link>

      <div className="mt-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-amber-200/60 sm:p-8">
        <h1 className="text-lg font-extrabold text-[#4a2f1c]">{thread.requestTitle}</h1>
        <p className="mt-1 text-xs text-[#b89a7c]">
          {thread.buyerDisplayName} · {thread.sellerDisplayName}
        </p>

        <ul className="mt-6 flex flex-col gap-3">
          {messages.map((message) => {
            const mine = message.senderId === thread.viewerId;
            return (
              <li key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                    mine
                      ? "bg-[#d9822b] text-white"
                      : "bg-amber-50 text-[#4a2f1c] ring-1 ring-amber-200/60"
                  }`}
                >
                  <p className="whitespace-pre-line">{message.body}</p>
                </div>
              </li>
            );
          })}
        </ul>

        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-2 text-xs text-red-700">
            {error}
          </p>
        )}

        <form ref={formRef} onSubmit={submit} className="mt-6 flex gap-2">
          <input
            name="body"
            type="text"
            maxLength={2000}
            disabled={pending}
            placeholder="메시지를 입력하세요"
            className="flex-1 rounded-xl border border-amber-200 px-4 py-2.5 text-sm text-[#4a2f1c] outline-none focus:border-[#d9822b] focus:ring-2 focus:ring-[#d9822b]/30"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-full bg-[#d9822b] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#c46f1d] disabled:cursor-not-allowed disabled:opacity-60"
          >
            전송
          </button>
        </form>
      </div>
    </div>
  );
}
