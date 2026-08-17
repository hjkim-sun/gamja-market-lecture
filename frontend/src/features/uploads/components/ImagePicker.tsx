"use client";

import { useRef, useState } from "react";

type PickedImage = {
  file: File;
  previewUrl: string;
};

/**
 * Optional multi-file `images` picker shared by `RequestForm`/`ApplyForm`
 * (`docs/specs/14-...design.md` §7). Renders a native `<input type="file" name="images"
 * multiple>` — the browser attaches every selected `File` to the enclosing form's
 * `FormData` on its own, so no submit-time wiring is needed here — plus a local preview
 * grid with a per-file remove button. Removing a file rebuilds the input's `FileList` via
 * `DataTransfer` so the actual submission stays in sync with what's shown.
 */
export default function ImagePicker() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<PickedImage[]>([]);

  function applySelection(next: PickedImage[]) {
    setImages(next);
    if (inputRef.current && typeof DataTransfer !== "undefined") {
      const transfer = new DataTransfer();
      next.forEach((image) => transfer.items.add(image.file));
      inputRef.current.files = transfer.files;
    }
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    images.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    setImages(files.map((file) => ({ file, previewUrl: URL.createObjectURL(file) })));
  }

  function removeAt(index: number) {
    const target = images[index];
    if (target) URL.revokeObjectURL(target.previewUrl);
    applySelection(images.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="images" className="text-sm font-semibold text-[#4a2f1c]">
        사진 (선택, 최대 5장)
      </label>
      <input
        ref={inputRef}
        id="images"
        name="images"
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        onChange={handleChange}
        className="text-sm text-[#6b5540] file:mr-3 file:rounded-full file:border-0 file:bg-amber-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[#8a6a4a]"
      />
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {images.map((image, index) => (
            <div
              key={image.previewUrl}
              className="relative aspect-square overflow-hidden rounded-xl ring-1 ring-amber-200/60"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob: preview, not a next/image asset */}
              <img src={image.previewUrl} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removeAt(index)}
                aria-label="사진 제거"
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
