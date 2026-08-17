import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ImagePicker from "@/features/uploads/components/ImagePicker";

describe("ImagePicker", () => {
  it("renders an optional multi-file images input restricted to the supported formats", () => {
    const html = renderToStaticMarkup(<ImagePicker />);

    expect(html).toContain('type="file"');
    expect(html).toContain('name="images"');
    expect(html).toContain("multiple");
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
  });
});
