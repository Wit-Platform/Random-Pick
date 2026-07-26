import { categoryLabel } from "./categories";
import { distanceM, metersPerDegLng, M_PER_DEG_LAT } from "./geo";
import { hashInts, mulberry32, pick, type Rand } from "./prng";
import type { CategoryId, LatLng, Place } from "./types";

/**
 * 카카오 REST 키가 없거나 API가 실패했을 때 쓰는 폴백 생성기.
 *
 * 좌표 격자를 시드로 쓰기 때문에 **같은 좌표를 조회한 사람은 모두 같은 식당 목록**을
 * 봅니다. 그룹 플레이에서 조건이 같으면 결과 세계가 같아야 하므로 Math.random을
 * 쓰지 않는 것이 중요합니다.
 */

/** 격자 한 칸 ≈ 200m */
const CELL_LAT = 0.0018;
const CELL_LNG = 0.0022;

/** 폭주 방지 — 반경 3km에서도 30칸 안쪽입니다 */
const MAX_CELLS_PER_AXIS = 48;

interface NamePool {
  prefix: readonly string[];
  suffix: readonly string[];
}

const NAMES: Record<CategoryId, NamePool> = {
  ko: {
    prefix: ["할매", "옛골", "종로", "진미", "소나무", "장수", "시골", "명가", "솔밭", "한터", "고향", "금촌", "백년", "우리"],
    suffix: ["순대국밥", "김치찌개", "제육볶음", "보쌈", "생선구이", "돌솥비빔밥", "갈비탕", "설렁탕", "곰탕", "백반", "해장국", "닭한마리"],
  },
  cn: {
    prefix: ["홍복", "만리장성", "금룡", "향원", "태화", "복성", "동방루", "래방", "취홍"],
    suffix: ["반점", "짜장", "짬뽕", "마라탕", "양꼬치", "중화요리", "탕수육"],
  },
  jp: {
    prefix: ["미소", "사쿠라", "하나", "기꾸", "야마", "코이", "이치", "토모"],
    suffix: ["초밥", "라멘", "돈카츠", "우동", "규동", "텐동", "소바", "카레"],
  },
  we: {
    prefix: ["보노", "라피", "오스테리아", "비스트로", "피에스타", "더그릴", "마리오", "카사"],
    suffix: ["파스타", "피자", "스테이크", "브런치", "리조또", "버거", "파니니"],
  },
  bs: {
    prefix: ["엄마손", "신전", "이모네", "국대", "청춘", "할리", "동대문", "분식왕"],
    suffix: ["떡볶이", "김밥", "분식", "라면", "순대", "튀김", "쫄면"],
  },
  cf: {
    prefix: ["로스터리", "한잔", "모노", "블루", "오후", "공간", "여백", "온"],
    suffix: ["커피", "로스터스", "카페", "베이커리", "디저트", "브루잉"],
  },
  et: {
    prefix: ["아시안", "사이공", "방콕", "델리", "타코", "케밥", "청년", "그릇"],
    suffix: ["누들", "포", "반미", "커리", "타코", "케밥", "치킨", "도시락"],
  },
};

/** 한식·카페가 실제로도 가장 많으므로 가중치를 둡니다 */
const CATEGORY_WEIGHTS: ReadonlyArray<[CategoryId, number]> = [
  ["ko", 0.3],
  ["cf", 0.2],
  ["bs", 0.12],
  ["jp", 0.12],
  ["cn", 0.1],
  ["we", 0.09],
  ["et", 0.07],
];

function weightedCategory(rand: Rand): CategoryId {
  const r = rand();
  let acc = 0;
  for (const [id, w] of CATEGORY_WEIGHTS) {
    acc += w;
    if (r < acc) return id;
  }
  return "et";
}

/** 밀집 구역과 한적한 구역이 생기도록 칸마다 개수를 다르게 */
function countForCell(rand: Rand): number {
  const r = rand();
  if (r < 0.18) return 0;
  if (r < 0.45) return 1;
  if (r < 0.72) return 2;
  if (r < 0.92) return 3;
  return 4;
}

function placesInCell(iLat: number, iLng: number): Place[] {
  const rand = mulberry32(hashInts(iLat, iLng, 0x5f3a));
  const count = countForCell(rand);
  if (count === 0) return [];

  const out: Place[] = [];
  for (let i = 0; i < count; i++) {
    const cat = weightedCategory(rand);
    const pool = NAMES[cat];
    const suffix = pick(rand, pool.suffix);
    const name = `${pick(rand, pool.prefix)} ${suffix}`;

    // 칸 경계(=도로변)에 가깝게 배치해서 블록 한가운데 뜨는 걸 피합니다
    const alongEdge = 0.08 + rand() * 0.84;
    const edge = Math.floor(rand() * 4);
    let fx: number;
    let fy: number;
    if (edge === 0) {
      fx = alongEdge;
      fy = 0.06 + rand() * 0.1;
    } else if (edge === 1) {
      fx = alongEdge;
      fy = 0.84 + rand() * 0.1;
    } else if (edge === 2) {
      fx = 0.06 + rand() * 0.1;
      fy = alongEdge;
    } else {
      fx = 0.84 + rand() * 0.1;
      fy = alongEdge;
    }

    out.push({
      id: `sample:${iLat}:${iLng}:${i}`,
      name,
      cat,
      detail: `${categoryLabel(cat)} › ${suffix}`,
      lat: (iLat + fy) * CELL_LAT,
      lng: (iLng + fx) * CELL_LNG,
    });
  }
  return out;
}

/** 중심 반경 내 샘플 식당. 거리순 정렬해서 반환합니다. */
export function mockPlaces(center: LatLng, radiusM: number): Place[] {
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLng = radiusM / metersPerDegLng(center.lat);

  const latFrom = Math.floor((center.lat - dLat) / CELL_LAT);
  const latTo = Math.floor((center.lat + dLat) / CELL_LAT);
  const lngFrom = Math.floor((center.lng - dLng) / CELL_LNG);
  const lngTo = Math.floor((center.lng + dLng) / CELL_LNG);

  const latEnd = Math.min(latTo, latFrom + MAX_CELLS_PER_AXIS);
  const lngEnd = Math.min(lngTo, lngFrom + MAX_CELLS_PER_AXIS);

  const found: Array<{ place: Place; dist: number }> = [];
  for (let iLat = latFrom; iLat <= latEnd; iLat++) {
    for (let iLng = lngFrom; iLng <= lngEnd; iLng++) {
      for (const place of placesInCell(iLat, iLng)) {
        const dist = distanceM(center, place);
        if (dist <= radiusM) found.push({ place, dist });
      }
    }
  }

  found.sort((a, b) => a.dist - b.dist);
  return found.map((f) => f.place);
}
