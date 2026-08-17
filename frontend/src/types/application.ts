import type { UploadedImage } from "@/types/upload";

export type ApplicationStatus = "대기중" | "수락됨" | "거절됨";

export type CreateApplicationInput = {
  offeredPrice: number;
  message: string;
};

/** Response of `POST /api/requests/{id}/applications`. `images` is always `[]` here —
 * photos are attached in a follow-up call after creation (`docs/specs/14-...design.md` §4.3). */
export type CreatedApplication = {
  id: string;
  requestId: string;
  offeredPrice: number;
  message: string;
  status: ApplicationStatus;
  createdAt: string;
  images?: UploadedImage[];
};

/** One row of `GET /api/requests/{id}/applications` — the request owner's view.
 * `images` are signed URLs, visible only because this response is owner-scoped. */
export type OwnerApplication = {
  id: string;
  sellerDisplayName: string;
  offeredPrice: number;
  message: string;
  status: ApplicationStatus;
  createdAt: string;
  images?: UploadedImage[];
};

/** One row of `GET /api/applications/mine` — the applying seller's view.
 * `images` are signed URLs, visible only to the seller who submitted them. */
export type MyApplication = {
  id: string;
  requestId: string;
  requestTitle: string;
  offeredPrice: number;
  message: string;
  status: ApplicationStatus;
  createdAt: string;
  images?: UploadedImage[];
};

export type ApplicationDecision = "accept" | "reject";

/** Response of `PATCH /api/applications/{id}`. `chatThreadId` is present only on `accept`. */
export type DecideApplicationResult = {
  application: CreatedApplication;
  chatThreadId?: string;
};
