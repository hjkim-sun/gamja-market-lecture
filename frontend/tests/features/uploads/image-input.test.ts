import { describe, expect, it } from "vitest";

import { validateImageFiles } from "@/features/uploads/lib/image-input";

function image(type = "image/png", size = 3): File {
  return new File([new Uint8Array(size)], "untrusted-name", { type });
}

describe("validateImageFiles", () => {
  it("allows an empty optional selection and one to five supported image files", () => {
    expect(validateImageFiles([])).toEqual({ ok: true });
    expect(validateImageFiles([image("image/jpeg"), image("image/png"), image("image/webp")])).toEqual({ ok: true });
  });

  it("rejects more than five files, an unsupported MIME type, and a file larger than 5 MB", () => {
    expect(validateImageFiles(Array.from({ length: 6 }, () => image()))).toMatchObject({ ok: false });
    expect(validateImageFiles([image("application/pdf")])).toMatchObject({ ok: false });
    expect(validateImageFiles([image("image/png", 5 * 1024 * 1024 + 1)])).toMatchObject({ ok: false });
  });
});
