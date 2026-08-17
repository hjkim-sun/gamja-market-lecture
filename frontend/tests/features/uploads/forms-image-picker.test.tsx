import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ApplyForm from "@/features/applications/components/ApplyForm";
import RequestForm from "@/features/requests/components/RequestForm";

describe("request and application forms", () => {
  it.each([
    ["purchase request", <RequestForm key="request" />],
    ["seller application", <ApplyForm key="application" requestId="request-1" />],
  ])("includes the shared optional image picker for %s", (_label, form) => {
    const html = renderToStaticMarkup(form);

    expect(html).toContain('type="file"');
    expect(html).toContain('name="images"');
    expect(html).toContain("multiple");
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
  });
});
