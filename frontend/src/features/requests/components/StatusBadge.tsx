import type { PurchaseRequest } from "@/types/request";

const STYLES: Record<PurchaseRequest["status"], string> = {
  모집중: "bg-emerald-100 text-emerald-700",
  협의중: "bg-amber-100 text-amber-700",
  마감: "bg-stone-200 text-stone-500",
};

export default function StatusBadge({
  status,
}: {
  status: PurchaseRequest["status"];
}) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${STYLES[status]}`}
    >
      {status}
    </span>
  );
}
