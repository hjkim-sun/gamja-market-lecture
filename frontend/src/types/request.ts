import type { RequestCategory } from "@/features/requests/lib/request-input";
import type { ApplicationStatus } from "@/types/application";
import type { UploadedImage } from "@/types/upload";

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
   * Attached reference photos, public-URL, oldest slot (`sortOrder: 0`) first. Absent from
   * older/mocked payloads that predate photo uploads — always read as `images ?? []`.
   */
  images?: UploadedImage[];
  /**
   * The signed-in viewer's own application status for this request, or `null` when the
   * viewer has not applied. `undefined` for anonymous viewers and for the owner, and
   * absent from the list endpoint (`GET /api/requests`) — hence optional.
   */
  viewerApplicationStatus?: ApplicationStatus | null;
  /**
   * Number of applications received so far. Populated for the owner only when the
   * backend sends it; treated as unknown (not zero) when absent so the UI still
   * offers a way to reach the applications list rather than assuming there are none.
   */
  applicationCount?: number;
  /**
   * The viewer's matched chat thread id once the request is `협의중`/`마감`, for
   * whichever side (buyer or seller) the viewer is on. `null`/absent when no match
   * exists yet, or when the backend has not resolved it for this viewer role.
   */
  viewerChatThreadId?: string | null;
};

/** One row of `GET /api/requests/mine` — always owned by the signed-in viewer. */
export type MyPurchaseRequest = {
  id: string;
  title: string;
  desiredPrice: number;
  status: "모집중" | "협의중" | "마감";
  category: RequestCategory;
  createdAt: string;
  description: string;
  applicationCount: number;
  images?: UploadedImage[];
};
