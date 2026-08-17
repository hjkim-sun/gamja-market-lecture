/**
 * One image attached to a purchase request or a seller application. Shared shape for
 * `RequestImageOut`/`ApplicationImageOut` (`docs/specs/14-...design.md` §4.3) — the two
 * differ only in how the backend resolves `url` (public vs. signed), not in the shape
 * the frontend consumes.
 */
export type UploadedImage = {
  id: string;
  url: string;
  sortOrder: number;
};
