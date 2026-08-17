import type { RequestCategory } from "@/features/requests/lib/request-input";

export type PurchaseRequest = {
  id: string;
  title: string;
  desiredPrice: number;
  status: "모집중" | "협의중" | "마감";
  category: RequestCategory;
  createdAt: string;
  description: string;
};
