import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSameOriginRequest: vi.fn(),
}));

vi.mock("@/lib/api/same-origin-request", () => ({
  getSameOriginRequest: mocks.getSameOriginRequest,
}));

import { getMyRequests, getRequestById } from "@/features/requests/data/requests-api";

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

describe("getMyRequests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns the owner-only requests with their application counts", async () => {
    mocks.getSameOriginRequest.mockResolvedValue({ cookie: "gm_session=abc", url: "https://gamja.example/api/requests/mine" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: "request-1", applicationCount: 2 }]), { status: 200 })));

    await expect(getMyRequests()).resolves.toEqual({ ok: true, requests: [{ id: "request-1", applicationCount: 2 }] });
  });

  it.each([
    ["an unauthenticated response", () => new Response(null, { status: 401 })],
    ["a network failure", () => Promise.reject(new Error("network down"))],
  ])("returns a failed result for %s", async (_scenario, response) => {
    mocks.getSameOriginRequest.mockResolvedValue({ url: "https://gamja.example/api/requests/mine" });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(response));

    await expect(getMyRequests()).resolves.toMatchObject({ ok: false });
  });
});
