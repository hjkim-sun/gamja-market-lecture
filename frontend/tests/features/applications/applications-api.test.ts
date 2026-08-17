import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ headers: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));

import { getMyApplications } from "@/features/applications/data/applications-api";

describe("getMyApplications", () => {
  beforeEach(() => {
    mocks.headers.mockResolvedValue(new Headers({
      host: "gamja.example",
      "x-forwarded-proto": "https",
      cookie: "gm_session=abc",
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("returns ok:true with the parsed list on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } }),
    ));

    await expect(getMyApplications()).resolves.toEqual({ ok: true, applications: [] });
  });

  it("returns ok:false with the backend status on a 401, instead of silently returning an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    await expect(getMyApplications()).resolves.toEqual({ ok: false, status: 401 });
  });

  it("returns ok:false with status 0 on a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(getMyApplications()).resolves.toEqual({ ok: false, status: 0 });
  });
});
