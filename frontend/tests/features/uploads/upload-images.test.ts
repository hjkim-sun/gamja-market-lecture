import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSameOriginRequest: vi.fn() }));

vi.mock("@/lib/api/same-origin-request", () => ({ getSameOriginRequest: mocks.getSameOriginRequest }));

import { uploadImages } from "@/features/uploads/data/upload-images";

describe("uploadImages", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends every selected file as multipart images without overriding the browser Content-Type boundary", async () => {
    const files = [
      new File(["first"], "first.png", { type: "image/png" }),
      new File(["second"], "second.webp", { type: "image/webp" }),
    ];
    mocks.getSameOriginRequest.mockResolvedValue({ url: "https://gamja.example/api/requests/request-1/images" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      images: [
        { id: "image-1", url: "memory://request-images/request-1/image-1.png", sortOrder: 0 },
        { id: "image-2", url: "memory://request-images/request-1/image-2.webp", sortOrder: 1 },
      ],
    }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadImages("/api/requests/request-1/images", files, "gm_session=abc")).resolves.toEqual({
      ok: true,
      images: expect.arrayContaining([expect.objectContaining({ sortOrder: 0 })]),
    });

    expect(mocks.getSameOriginRequest).toHaveBeenCalledWith("/api/requests/request-1/images");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init).toMatchObject({ method: "POST", headers: { Cookie: "gm_session=abc" } });
    expect(init.headers).not.toHaveProperty("Content-Type");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).getAll("images")).toHaveLength(2);
  });

  it("returns the API error message instead of throwing when the optimistic image upload fails", async () => {
    mocks.getSameOriginRequest.mockResolvedValue({ url: "https://gamja.example/api/applications/application-1/images" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "사진 형식을 확인해주세요." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })));

    await expect(uploadImages("/api/applications/application-1/images", [new File(["bad"], "bad.gif", { type: "image/gif" })], null))
      .resolves.toEqual({ ok: false, message: "사진 형식을 확인해주세요." });
  });
});
