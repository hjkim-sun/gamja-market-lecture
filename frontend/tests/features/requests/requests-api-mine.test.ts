import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSameOriginRequest: vi.fn(),
}));

vi.mock("@/lib/api/same-origin-request", () => ({
  getSameOriginRequest: mocks.getSameOriginRequest,
}));

import { getMyRequests } from "@/features/requests/data/requests-api";

describe("getMyRequests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns a discriminated success result with the signed-in user's purchase requests", async () => {
    mocks.getSameOriginRequest.mockResolvedValue({
      cookie: "gm_session=abc",
      url: "https://gamja.example/api/requests/mine",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })));

    await expect(getMyRequests()).resolves.toEqual({ ok: true, requests: [] });
  });

  it("returns a discriminated failure result with the API status", async () => {
    mocks.getSameOriginRequest.mockResolvedValue({
      cookie: "gm_session=abc",
      url: "https://gamja.example/api/requests/mine",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    await expect(getMyRequests()).resolves.toEqual({ ok: false, status: 401 });
  });

  it("reports a network failure as a status-zero discriminated failure", async () => {
    mocks.getSameOriginRequest.mockResolvedValue({
      cookie: "gm_session=abc",
      url: "https://gamja.example/api/requests/mine",
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(getMyRequests()).resolves.toEqual({ ok: false, status: 0 });
  });
});
