import type { CategoryId } from "./types";

export interface CategoryMeta {
  id: CategoryId;
  label: string;
  /** 지도 위 후보 점 색. 라이트/다크 각각 */
  dot: string;
  dotDark: string;
}

export const CATEGORIES: readonly CategoryMeta[] = [
  { id: "ko", label: "한식", dot: "#A8562E", dotDark: "#D98A5B" },
  { id: "cn", label: "중식", dot: "#8E3B4E", dotDark: "#D1748A" },
  { id: "jp", label: "일식", dot: "#3E7C8C", dotDark: "#6FB6C8" },
  { id: "we", label: "양식", dot: "#5C5C9E", dotDark: "#9A9AD8" },
  { id: "bs", label: "분식", dot: "#C07C1E", dotDark: "#E5B65C" },
  { id: "cf", label: "카페", dot: "#7A6A55", dotDark: "#BCA98C" },
  { id: "et", label: "기타", dot: "#3F7A55", dotDark: "#77BC8F" },
];

export const ALL_CATEGORY_IDS: readonly CategoryId[] = CATEGORIES.map(
  (c) => c.id,
);

const CATEGORY_BY_ID = new Map<CategoryId, CategoryMeta>(
  CATEGORIES.map((c) => [c.id, c]),
);

export function categoryMeta(id: CategoryId): CategoryMeta {
  const found = CATEGORY_BY_ID.get(id);
  if (!found) throw new Error(`unknown category: ${id}`);
  return found;
}

export function categoryLabel(id: CategoryId): string {
  return categoryMeta(id).label;
}

/**
 * 카카오 category_name 2번째 토큰 → 게임 대분류.
 * 예: "음식점 > 한식 > 국밥" → 한식 → "ko"
 */
const KAKAO_SECOND_TOKEN: Record<string, CategoryId> = {
  한식: "ko",
  중식: "cn",
  일식: "jp",
  양식: "we",
  피자: "we",
  분식: "bs",
  카페: "cf",
  // 아래는 명시적으로 "기타"로 접습니다
  치킨: "et",
  패스트푸드: "et",
  아시아음식: "et",
  뷔페: "et",
  도시락: "et",
  샐러드: "et",
  퓨전요리: "et",
  이색음식점: "et",
  간식: "et",
  "육류,고기": "et",
};

/**
 * 점심 게임이므로 술집 계열은 후보에서 제외합니다. (기획서 D7-A)
 * FD6 카테고리에 호프·요리주점이 섞여 들어오기 때문에 필요한 필터입니다.
 */
const EXCLUDE_TOKENS = ["술집", "요리주점", "호프", "바(BAR)", "포장마차"];

export function isExcludedByCategory(categoryName: string): boolean {
  return EXCLUDE_TOKENS.some((t) => categoryName.includes(t));
}

/** 카카오 category_name을 게임 대분류로 접습니다. 매칭 실패 시 "기타". */
export function categoryFromKakao(categoryName: string): CategoryId {
  const parts = categoryName.split(">").map((s) => s.trim());
  const second = parts[1] ?? "";
  return KAKAO_SECOND_TOKEN[second] ?? "et";
}

/** 결과 카드에 보여줄 세부 분류 ("한식 > 국밥"에서 앞의 "음식점 >"만 떼기) */
export function detailFromKakao(categoryName: string): string {
  const parts = categoryName
    .split(">")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.slice(1).join(" › ") || parts.join(" › ");
}

/** 어떤 카카오 category_group_code를 조회해야 하는지 — 쿼터 절약용 */
export function groupCodesFor(cats: readonly CategoryId[]): string[] {
  const codes: string[] = [];
  if (cats.some((c) => c !== "cf")) codes.push("FD6");
  if (cats.includes("cf")) codes.push("CE7");
  return codes;
}
