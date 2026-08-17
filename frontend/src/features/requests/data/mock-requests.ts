import type { PurchaseRequest } from "@/types/request";

export const mockRequests: PurchaseRequest[] = [
  {
    id: "1",
    title: "아이폰 14 프로 128GB 자급제 (딥퍼플)",
    desiredPrice: 750000,
    status: "모집중",
    category: "디지털기기",
    createdAt: "2026-08-10",
    description:
      "상태 좋은 아이폰 14 프로 자급제 찾습니다. 딥퍼플 색상 선호하고, 배터리 효율 85% 이상이면 좋겠어요. 직거래는 강남역 근처 가능합니다.",
  },
  {
    id: "2",
    title: "원목 4인용 식탁 세트",
    desiredPrice: 200000,
    status: "모집중",
    category: "가구/인테리어",
    createdAt: "2026-08-11",
    description:
      "이사하면서 새 식탁을 찾고 있어요. 원목 소재에 의자 4개 포함이면 좋겠고, 스크래치 정도는 괜찮습니다. 배송 가능하신 분 우대합니다.",
  },
  {
    id: "3",
    title: "닌텐도 스위치 OLED 본체",
    desiredPrice: 280000,
    status: "협의중",
    category: "게임/취미",
    createdAt: "2026-08-12",
    description:
      "화이트 색상 OLED 모델 찾습니다. 구성품(독, 조이콘, 충전기) 다 있으면 좋겠어요. 박스 유무는 상관없습니다.",
  },
  {
    id: "4",
    title: "여성용 자전거 (26인치)",
    desiredPrice: 120000,
    status: "모집중",
    category: "스포츠/레저",
    createdAt: "2026-08-13",
    description:
      "출퇴근용으로 탈 26인치 자전거를 찾고 있습니다. 기어 있는 모델이면 더 좋아요. 타이어 상태 좋은 것 위주로 부탁드려요.",
  },
  {
    id: "5",
    title: "무선 청소기 (다이슨 계열)",
    desiredPrice: 150000,
    status: "모집중",
    category: "생활가전",
    createdAt: "2026-08-13",
    description:
      "흡입력 괜찮은 무선 청소기 찾아요. 배터리 사용시간 20분 이상, 헤드 종류 다양하면 좋겠습니다.",
  },
  {
    id: "6",
    title: "캠핑용 텐트 (4인용)",
    desiredPrice: 90000,
    status: "마감",
    category: "스포츠/레저",
    createdAt: "2026-08-09",
    description:
      "가을 캠핑 시즌 대비해서 4인용 텐트 구합니다. 방수 잘되는 제품이면 좋겠고, 폴대 상태 확인 부탁드려요.",
  },
];

export function getMockRequestById(id: string): PurchaseRequest | undefined {
  return mockRequests.find((request) => request.id === id);
}
