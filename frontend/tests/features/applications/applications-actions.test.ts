import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  redirect: vi.fn(),
  uploadImages: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("@/features/uploads/data/upload-images", () => ({ uploadImages: mocks.uploadImages }));

import { applyToRequest, decideApplication } from "@/features/applications/actions/applications";

function applicationForm(offeredPrice = "700000", message = "동일 모델 재고가 있고 오늘 바로 거래할 수 있습니다.") {
  const form = new FormData();
  form.set("offeredPrice", offeredPrice);
  form.set("message", message);
  return form;
}

function applicationFormWithImage() {
  const form = applicationForm();
  form.append("images", new File(["image"], "my-product.png", { type: "image/png" }));
  return form;
}

describe("seller application actions", () => {
  beforeEach(() => {
    mocks.headers.mockReset();
    mocks.redirect.mockClear();
    mocks.uploadImages.mockReset();
    mocks.uploadImages.mockResolvedValue({ ok: true, images: [] });
    mocks.headers.mockResolvedValue(new Headers({
      host: "gamja.example",
      "x-forwarded-proto": "https",
      cookie: "gm_session=abc",
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns field errors without calling the network for an invalid form", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await applyToRequest("request-1", applicationForm("0"));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, errors: { offeredPrice: expect.any(String) } });
  });

  it("posts to the request's applications endpoint and redirects to the request on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "application-1",
      requestId: "request-1",
      offeredPrice: 700000,
      message: "동일 모델 재고가 있고 오늘 바로 거래할 수 있습니다.",
      status: "대기중",
      createdAt: "2026-08-17T00:00:00.000Z",
    }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(applyToRequest("request-1", applicationForm())).rejects.toThrow("NEXT_REDIRECT:/requests/request-1");

    expect(fetchMock).toHaveBeenCalledWith("https://gamja.example/api/requests/request-1/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "gm_session=abc" },
      credentials: "include",
      body: JSON.stringify({ offeredPrice: 700000, message: "동일 모델 재고가 있고 오늘 바로 거래할 수 있습니다." }),
    });
  });

  it("creates the application before uploading selected product images and redirects even when that upload fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "application-1",
      requestId: "request-1",
      offeredPrice: 700000,
      message: "동일 모델 재고가 있고 오늘 바로 거래할 수 있습니다.",
      status: "대기중",
      createdAt: "2026-08-17T00:00:00.000Z",
    }), { status: 201, headers: { "content-type": "application/json" } }));
    mocks.uploadImages.mockResolvedValue({ ok: false, message: "사진 업로드에 실패했어요." });
    vi.stubGlobal("fetch", fetchMock);

    await expect(applyToRequest("request-1", applicationFormWithImage()))
      .rejects.toThrow("NEXT_REDIRECT:/requests/request-1");

    expect(mocks.uploadImages).toHaveBeenCalledWith(
      "/api/applications/application-1/images",
      [expect.any(File)],
      "gm_session=abc",
    );
  });

  it("redirects to login with the apply path preserved on an expired session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    await expect(applyToRequest("request-1", applicationForm()))
      .rejects.toThrow("NEXT_REDIRECT:/login?next=/requests/request-1/apply");
  });

  it.each([403, 409])("surfaces a blocked state instead of the form for backend status %i", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "already_applied", message: "이미 지원했어요." }), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ));

    await expect(applyToRequest("request-1", applicationForm())).resolves.toEqual({
      ok: false,
      message: "이미 지원했어요.",
      blocked: true,
    });
  });

  it("accepts an application and returns the created chat thread id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      application: {
        id: "application-1",
        requestId: "request-1",
        offeredPrice: 700000,
        message: "동일 모델 재고가 있고 오늘 바로 거래할 수 있습니다.",
        status: "수락됨",
        createdAt: "2026-08-17T00:00:00.000Z",
      },
      chatThreadId: "thread-1",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await decideApplication("application-1", "accept");

    expect(fetchMock).toHaveBeenCalledWith("https://gamja.example/api/applications/application-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: "gm_session=abc" },
      credentials: "include",
      body: JSON.stringify({ decision: "accept" }),
    });
    expect(result).toEqual({
      ok: true,
      result: {
        application: expect.objectContaining({ status: "수락됨" }),
        chatThreadId: "thread-1",
      },
    });
  });

  it("reports an already-decided conflict distinctly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "application_already_decided", message: "이미 처리된 지원이에요." }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    ));

    const result = await decideApplication("application-1", "reject");

    expect(result).toEqual({ ok: false, message: "다른 브라우저에서 이미 처리됐어요.", alreadyDecided: true });
  });
});
