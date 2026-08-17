"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import StatusBadge from "./StatusBadge";
import type { PurchaseRequest } from "@/types/request";

export default function SearchableRequestGrid({
  requests,
}: {
  requests: PurchaseRequest[];
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return requests;
    return requests.filter(
      (request) =>
        request.title.toLowerCase().includes(q) ||
        request.category.toLowerCase().includes(q),
    );
  }, [requests, query]);

  return (
    <div>
      <div className="relative mx-auto mb-10 max-w-xl">
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-amber-500"
        >
          <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M14 14L18 18"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="어떤 물건을 찾고 있나요?"
          className="w-full rounded-full border border-amber-200 bg-white py-3.5 pl-11 pr-4 text-sm text-[#4a2f1c] shadow-sm outline-none placeholder:text-[#c4a988] focus:border-[#d9822b] focus:ring-2 focus:ring-[#d9822b]/30 sm:text-base"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-[#8a6a4a]">
          &ldquo;{query}&rdquo;에 대한 구매요청을 찾지 못했어요.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((request) => (
            <Link
              key={request.id}
              href={`/requests/${request.id}`}
              className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-amber-200/60 transition hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-600">
                  {request.category}
                </span>
                <StatusBadge status={request.status} />
              </div>
              <h2 className="line-clamp-2 font-bold text-[#4a2f1c]">
                {request.title}
              </h2>
              <p className="text-lg font-extrabold text-[#d9822b]">
                {request.desiredPrice.toLocaleString()}원
              </p>
              <p className="text-xs text-[#b89a7c]">{request.createdAt} 등록</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
