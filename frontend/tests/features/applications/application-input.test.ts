import { describe, expect, it } from "vitest";
import { parseApplicationForm } from "@/features/applications/lib/application-input";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("seller application input", () => {
  it("normalizes a valid offer and ignores client-owned fields", () => {
    expect(parseApplicationForm(form({
      offeredPrice: " 700000 ",
      message: " 동일 모델 재고가 있고 오늘 바로 거래할 수 있습니다. ",
      sellerId: "attacker-controlled-id",
      status: "수락됨",
    }))).toEqual({
      ok: true,
      data: {
        offeredPrice: 700000,
        message: "동일 모델 재고가 있고 오늘 바로 거래할 수 있습니다.",
      },
    });
  });

  it.each([
    ["offeredPrice", { offeredPrice: "0" }],
    ["offeredPrice", { offeredPrice: "100000001" }],
    ["offeredPrice", { offeredPrice: "700.5" }],
    ["message", { message: "너무 짧아" }],
    ["message", { message: "가".repeat(501) }],
  ])("returns a field error for invalid %s", (field, replacement) => {
    const result = parseApplicationForm(form({
      offeredPrice: "700000",
      message: "동일 모델 재고가 있고 오늘 바로 거래할 수 있습니다.",
      ...replacement,
    }));

    expect(result).toMatchObject({ ok: false, errors: { [field]: expect.any(String) } });
  });
});
