export const REQUEST_CATEGORIES = [
  "디지털기기",
  "가구/인테리어",
  "게임/취미",
  "스포츠/레저",
  "생활가전",
  "기타",
] as const;

export type RequestCategory = (typeof REQUEST_CATEGORIES)[number];

export type CreateRequestInput = {
  title: string;
  category: RequestCategory;
  desiredPrice: number;
  description: string;
};

export type RequestFormErrors = Partial<
  Record<"title" | "category" | "desiredPrice" | "description", string>
>;

export type ParseRequestFormResult =
  | { ok: true; data: CreateRequestInput }
  | { ok: false; errors: RequestFormErrors };

const TITLE_MIN = 2;
const TITLE_MAX = 80;
const DESIRED_PRICE_MIN = 1;
const DESIRED_PRICE_MAX = 100_000_000;
const DESCRIPTION_MIN = 10;
const DESCRIPTION_MAX = 2000;

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function isRequestCategory(value: string): value is RequestCategory {
  return (REQUEST_CATEGORIES as readonly string[]).includes(value);
}

/** Parses and validates a purchase-request form. Client-owned fields like status/requesterId are dropped. */
export function parseRequestForm(formData: FormData): ParseRequestFormResult {
  const errors: RequestFormErrors = {};

  const title = textValue(formData, "title");
  if (title.length < TITLE_MIN || title.length > TITLE_MAX) {
    errors.title = "제목은 2자 이상 80자 이하로 입력해주세요.";
  }

  const categoryValue = textValue(formData, "category");
  if (!isRequestCategory(categoryValue)) {
    errors.category = "목록에 있는 카테고리 중 하나를 선택해주세요.";
  }

  const desiredPriceRaw = textValue(formData, "desiredPrice");
  const desiredPrice = Number(desiredPriceRaw);
  if (
    !desiredPriceRaw ||
    !Number.isInteger(desiredPrice) ||
    desiredPrice < DESIRED_PRICE_MIN ||
    desiredPrice > DESIRED_PRICE_MAX
  ) {
    errors.desiredPrice = "희망 가격은 1원 이상 1억원 이하 정수로 입력해주세요.";
  }

  const description = textValue(formData, "description");
  if (description.length < DESCRIPTION_MIN || description.length > DESCRIPTION_MAX) {
    errors.description = "상세 설명은 10자 이상 2000자 이하로 입력해주세요.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      title,
      category: categoryValue as RequestCategory,
      desiredPrice,
      description,
    },
  };
}
