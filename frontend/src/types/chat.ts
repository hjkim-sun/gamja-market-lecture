export type ChatViewerRole = "buyer" | "seller";

/** One row of `GET /api/chats`. */
export type ChatThreadSummary = {
  id: string;
  requestId: string;
  requestTitle: string;
  counterpartDisplayName: string;
  viewerRole: ChatViewerRole;
  lastMessageAt: string | null;
};

export type ChatMessage = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
};

/** Response of `GET /api/chats/{id}`. */
export type ChatThreadDetail = {
  id: string;
  requestId: string;
  requestTitle: string;
  buyerDisplayName: string;
  sellerDisplayName: string;
  viewerId: string;
  messages: ChatMessage[];
};
