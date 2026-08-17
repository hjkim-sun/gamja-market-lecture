import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSameOriginRequest: vi.fn(),
}));

vi.mock("@/lib/api/same-origin-request", () => ({
  getSameOriginRequest: mocks.getSameOriginRequest,
}));

import { getRequestById } from "@/features/requests/data/requests-api";

describe("getRequestById", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns null only when the API confirms the purchase request is absent with 404", async () => {
    mocks.getSameOriginRequest.mockResolvedValue({ url: "https://gamja.example/api/requests/missing" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(getRequestById("missing")).resolves.toBeNull();
  });

  it.each([
    ["a non-404 API response", () => new Response(null, { status: 500 })],
    ["a network failure", () => Promise.reject(new Error("network down"))],
  ])("surfaces %s so the route can render its load-error boundary", async (_scenario, response) => {
    mocks.getSameOriginRequest.mockResolvedValue({ url: "https://gamja.example/api/requests/request-1" });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(response));

    await expect(getRequestById("request-1")).rejects.toThrow();
  });
});
