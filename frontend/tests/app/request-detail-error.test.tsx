import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RequestDetailError from "@/app/requests/[id]/error";

describe("/requests/[id] load-error boundary", () => {
  it("shows a user-facing retry message instead of the not-found UI for retrieval failures", () => {
    const html = renderToStaticMarkup(
      <RequestDetailError error={new Error("request retrieval failed")} reset={vi.fn()} />,
    );

    expect(html).toContain("구매요청을 불러오지 못했어요");
    expect(html).toContain("잠시 후 다시 시도해 주세요.");
    expect(html).toContain("구매요청 목록으로 가기");
    expect(html).not.toContain("앗, 페이지를 찾을 수 없어요");
  });
});
