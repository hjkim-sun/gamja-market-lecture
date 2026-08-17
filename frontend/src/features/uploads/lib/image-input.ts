export type ValidateImageFilesResult = { ok: true } | { ok: false; message: string };

/** Mirrors the backend's application-level checks (`docs/specs/14-...design.md` §5) so the
 * client can reject obviously-invalid selections before spending a round trip. The server
 * re-validates everything (magic bytes, decoding) regardless — this is a UX hint only. */
const MAX_FILE_COUNT = 5;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Validates a client-side image selection. An empty selection is allowed — photos are optional. */
export function validateImageFiles(files: File[]): ValidateImageFilesResult {
  if (files.length === 0) {
    return { ok: true };
  }

  if (files.length > MAX_FILE_COUNT) {
    return { ok: false, message: "사진은 최대 5장까지 첨부할 수 있어요." };
  }

  for (const file of files) {
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return { ok: false, message: "JPEG, PNG, WEBP 형식의 사진만 첨부할 수 있어요." };
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return { ok: false, message: "사진은 한 장당 5MB 이하만 첨부할 수 있어요." };
    }
  }

  return { ok: true };
}

/** Pulls the selected `File`s out of a submitted form's `images` field, dropping any empty entry a browser may add when the input was untouched. */
export function collectImageFiles(formData: FormData, field = "images"): File[] {
  return formData.getAll(field).filter((value): value is File => value instanceof File && value.size > 0);
}
