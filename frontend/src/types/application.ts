export type ApplicationStatus = "대기중" | "수락됨" | "거절됨";

export type CreateApplicationInput = {
  offeredPrice: number;
  message: string;
};

/** Response of `POST /api/requests/{id}/applications`. */
export type CreatedApplication = {
  id: string;
  requestId: string;
  offeredPrice: number;
  message: string;
  status: ApplicationStatus;
  createdAt: string;
};

/** One row of `GET /api/requests/{id}/applications` — the request owner's view. */
export type OwnerApplication = {
  id: string;
  sellerDisplayName: string;
  offeredPrice: number;
  message: string;
  status: ApplicationStatus;
  createdAt: string;
};

/** One row of `GET /api/applications/mine` — the applying seller's view. */
export type MyApplication = {
  id: string;
  requestId: string;
  requestTitle: string;
  offeredPrice: number;
  message: string;
  status: ApplicationStatus;
  createdAt: string;
};

export type ApplicationDecision = "accept" | "reject";

/** Response of `PATCH /api/applications/{id}`. `chatThreadId` is present only on `accept`. */
export type DecideApplicationResult = {
  application: CreatedApplication;
  chatThreadId?: string;
};
