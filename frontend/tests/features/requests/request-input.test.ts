import { describe, expect, it } from "vitest";
import {
  REQUEST_CATEGORIES,
  parseRequestForm,
} from "@/features/requests/lib/request-input";

function requestForm(values: Record<string, string>) {
  const form = new FormData();
  Object.entries(values).forEach(([key, value]) => form.set(key, value));
  return form;
}

function validValues() {
  return {
    title: " 아이폰 14 프로 128GB ",
    category: "디지털기기",
    desiredPrice: "750000",
    description: " 상태 좋은 자급제 아이폰을 찾고 있습니다. ",
  };
}

describe("purchase request input", () => {
  it("exposes the single six-category source of truth", () => {
    expect(REQUEST_CATEGORIES).toEqual([
      "디지털기기",
      "가구/인테리어",
      "게임/취미",
      "스포츠/레저",
      "생활가전",
      "기타",
    ]);
  });

  it("normalizes valid form fields and drops client-owned fields", () => {
    expect(
      parseRequestForm(
        requestForm({
          ...validValues(),
          status: "마감",
          requesterId: "attacker-controlled-id",
        }),
      ),
    ).toEqual({
      ok: true,
      data: {
        title: "아이폰 14 프로 128GB",
        category: "디지털기기",
        desiredPrice: 750000,
        description: "상태 좋은 자급제 아이폰을 찾고 있습니다.",
      },
    });
  });

  it.each([
    ["title", { title: " 한 " }],
    ["category", { category: "의류" }],
    ["desiredPrice", { desiredPrice: "0" }],
    ["desiredPrice", { desiredPrice: "100000001" }],
    ["desiredPrice", { desiredPrice: "12.3" }],
    ["description", { description: "너무 짧음" }],
  ])("returns a field error for invalid %s", (field, replacement) => {
    const result = parseRequestForm(requestForm({ ...validValues(), ...replacement }));

    expect(result).toMatchObject({
      ok: false,
      errors: { [field]: expect.any(String) },
    });
  });
});
