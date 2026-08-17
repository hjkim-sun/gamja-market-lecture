export type PurchaseRequest = {
  id: string;
  title: string;
  desiredPrice: number;
  status: "모집중" | "협의중" | "마감";
  category: string;
  createdAt: string;
  description: string;
};
