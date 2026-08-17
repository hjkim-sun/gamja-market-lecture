import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  redirect: vi.fn(),
  uploadImages: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect.mockImplementation((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); }),
}));
vi.mock("@/features/uploads/data/upload-images", () => ({ uploadImages: mocks.uploadImages }));

import { createRequest } from "@/features/requests/actions/requests";

function requestForm() {
  const form = new FormData();
  form.set("title", "아이폰 14 프로 128GB 자급제");
  form.set("category", "디지털기기");
  form.set("desiredPrice", "750000");
  form.set("description", "상태 좋은 자급제 아이폰을 찾고 있습니다.");
  form.append("images", new File(["image"], "camera.png", { type: "image/png" }));
  return form;
}

describe("purchase request image submission", () => {
  beforeEach(() => {
    mocks.headers.mockResolvedValue(new Headers({ host: "gamja.example", "x-forwarded-proto": "https", cookie: "gm_session=abc" }));
    mocks.uploadImages.mockResolvedValue({ ok: true, images: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates text first, then uploads selected images with the created id before redirecting", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "request-1" }), { status: 201 })));

    await expect(createRequest(requestForm())).rejects.toThrow("NEXT_REDIRECT:/requests/request-1");

    expect(mocks.uploadImages).toHaveBeenCalledWith(
      "/api/requests/request-1/images",
      [expect.any(File)],
      "gm_session=abc",
    );
  });

  it("still redirects after a non-destructive image upload failure", async () => {
    mocks.uploadImages.mockResolvedValue({ ok: false, message: "사진 업로드에 실패했어요." });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "request-1" }), { status: 201 })));

    await expect(createRequest(requestForm())).rejects.toThrow("NEXT_REDIRECT:/requests/request-1");
  });
});
