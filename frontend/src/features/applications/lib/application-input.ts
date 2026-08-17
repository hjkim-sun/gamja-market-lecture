import type { CreateApplicationInput } from "@/types/application";

export type ApplicationFormErrors = Partial<Record<"offeredPrice" | "message", string>>;

export type ParseApplicationFormResult =
  | { ok: true; data: CreateApplicationInput }
  | { ok: false; errors: ApplicationFormErrors };

const OFFERED_PRICE_MIN = 1;
const OFFERED_PRICE_MAX = 100_000_000;
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 500;

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Parses and validates a seller-application form. Client-owned fields like status are dropped. */
export function parseApplicationForm(formData: FormData): ParseApplicationFormResult {
  const errors: ApplicationFormErrors = {};

  const offeredPriceRaw = textValue(formData, "offeredPrice");
  const offeredPrice = Number(offeredPriceRaw);
  if (
    !offeredPriceRaw ||
    !Number.isInteger(offeredPrice) ||
    offeredPrice < OFFERED_PRICE_MIN ||
    offeredPrice > OFFERED_PRICE_MAX
  ) {
    errors.offeredPrice = "제안 가격은 1원 이상 1억원 이하 정수로 입력해주세요.";
  }

  const message = textValue(formData, "message");
  if (message.length < MESSAGE_MIN || message.length > MESSAGE_MAX) {
    errors.message = "지원 메시지는 10자 이상 500자 이하로 입력해주세요.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      offeredPrice,
      message,
    },
  };
}
