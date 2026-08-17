import { getSameOriginRequest } from "@/lib/api/same-origin-request";
import type { UploadedImage } from "@/types/upload";

export type UploadImagesResult =
  | { ok: true; images: UploadedImage[] }
  | { ok: false; message: string };

const UPLOAD_FAILED_MESSAGE = "사진을 업로드하지 못했어요.";

/**
 * Uploads selected images to a request's/application's `.../images` endpoint as a
 * follow-up call after the parent resource was already created (`docs/specs/14-...design.md`
 * §7). Optimistic by contract — callers redirect regardless of the outcome. The body is a
 * `FormData` under the `images` field; `Content-Type` (and its multipart boundary) is left
 * for `fetch` to set, never specified manually.
 */
export async function uploadImages(
  endpoint: `/api/requests${string}` | `/api/applications${string}`,
  files: File[],
  cookie: string | null,
): Promise<UploadImagesResult> {
  const { url } = await getSameOriginRequest(endpoint);

  const formData = new FormData();
  for (const file of files) {
    formData.append("images", file);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: cookie ? { Cookie: cookie } : undefined,
      body: formData,
    });
  } catch {
    return { ok: false, message: UPLOAD_FAILED_MESSAGE };
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    return {
      ok: false,
      message: typeof body?.message === "string" ? body.message : UPLOAD_FAILED_MESSAGE,
    };
  }

  const parsed = (await response.json()) as { images: UploadedImage[] };
  return { ok: true, images: parsed.images };
}
