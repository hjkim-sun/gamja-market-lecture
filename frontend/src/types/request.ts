import type { RequestCategory } from "@/features/requests/lib/request-input";
import type { ApplicationStatus } from "@/types/application";

export type PurchaseRequest = {
  id: string;
  title: string;
  desiredPrice: number;
  status: "모집중" | "협의중" | "마감";
  category: RequestCategory;
  createdAt: string;
  description: string;
  isOwner: boolean;
  /**
   * The signed-in viewer's own application status for this request, or `null` when the
   * viewer has not applied. `undefined` for anonymous viewers and for the owner, and
   * absent from the list endpoint (`GET /api/requests`) — hence optional.
   */
  viewerApplicationStatus?: ApplicationStatus | null;
  /** Number of applications received so far. Populated for the owner only. */
  applicationCount?: number;
  /** The matched chat thread id once the request is `협의중`/`마감`. `null`/absent otherwise. */
  chatThreadId?: string | null;
};
