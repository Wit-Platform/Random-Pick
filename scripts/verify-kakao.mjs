#!/usr/bin/env node
/**
 * 카카오 로컬 API 실연동 검증.
 *
 * `src/lib/places-source.ts`와 `src/lib/categories.ts`는 **카카오 문서만 보고 짠 것**이고
 * 실제 응답으로 검증된 적이 없습니다. 이 스크립트는 REST 키로 진짜 호출을 한 번 해서
 * 우리가 가정한 것들이 실물과 맞는지 확인합니다.
 *
 *   KAKAO_REST_KEY=xxx node scripts/verify-kakao.mjs
 *   KAKAO_REST_KEY=xxx node scripts/verify-kakao.mjs 37.4979 127.0276 1000
 *
 * 확인 항목
 *   1. 인증이 통과하는지 (401이면 키가 잘못됐거나 REST 키가 아님)
 *   2. category_name이 "음식점 > 한식 > 국밥" 형태인지
 *   3. 2번째 토큰 집합이 우리 매핑 테이블에 있는지 — 없는 값은 전부 "기타"로 떨어집니다
 *   4. pageable_count 45 상한이 실제로 존재하는지
 *   5. 술집 필터가 뭘 걸러내는지
 *   6. 응답에 쿼터 관련 헤더가 오는지
 */

const ENDPOINT = "https://dapi.kakao.com/v2/local/search/category.json";

// src/lib/categories.ts의 KAKAO_SECOND_TOKEN과 같은 집합을 유지해야 합니다
const KNOWN_TOKENS = new Set([
  "한식", "중식", "일식", "양식", "피자", "분식", "카페",
  "치킨", "패스트푸드", "아시아음식", "뷔페", "도시락",
  "샐러드", "퓨전요리", "이색음식점", "간식", "육류,고기",
]);
const EXCLUDE_TOKENS = ["술집", "요리주점", "호프", "바(BAR)", "포장마차"];

const key = process.env.KAKAO_REST_KEY;
if (!key) {
  console.error("KAKAO_REST_KEY가 필요합니다.");
  console.error("  KAKAO_REST_KEY=xxx node scripts/verify-kakao.mjs");
  process.exit(1);
}

const lat = Number(process.argv[2] ?? 37.4979);
const lng = Number(process.argv[3] ?? 127.0276);
const radius = Number(process.argv[4] ?? 1000);

let exitCode = 0;
const fail = (msg) => {
  console.log(`  ✗ ${msg}`);
  exitCode = 1;
};
const pass = (msg) => console.log(`  ✓ ${msg}`);

async function fetchPage(code, page) {
  const params = new URLSearchParams({
    category_group_code: code,
    x: String(lng),
    y: String(lat),
    radius: String(radius),
    sort: "distance",
    size: "15",
    page: String(page),
  });
  const res = await fetch(`${ENDPOINT}?${params}`, {
    headers: { Authorization: `KakaoAK ${key}` },
  });
  return { res, body: res.ok ? await res.json() : await res.text() };
}

console.log(`\n기준점 ${lat}, ${lng} · 반경 ${radius}m\n`);

// 1. 인증
console.log("1. 인증");
const first = await fetchPage("FD6", 1);
if (first.res.status === 401) {
  fail("401 Unauthorized — REST API 키가 맞는지 확인하세요 (JavaScript 키 아님)");
  console.log(`     응답: ${String(first.body).slice(0, 200)}`);
  process.exit(1);
}
if (!first.res.ok) {
  fail(`HTTP ${first.res.status} — ${String(first.body).slice(0, 200)}`);
  process.exit(1);
}
pass(`HTTP 200 · documents ${first.body.documents.length}건`);

// 2. 쿼터 관련 헤더
console.log("\n2. 응답 헤더");
const interesting = [...first.res.headers.entries()].filter(([k]) =>
  /ratelimit|quota|remain|retry/i.test(k),
);
if (interesting.length === 0) {
  console.log("  · 쿼터 관련 헤더 없음 — 콘솔에서 직접 확인해야 합니다");
} else {
  for (const [k, v] of interesting) console.log(`  · ${k}: ${v}`);
}

// 3. category_name 형식
console.log("\n3. category_name 형식");
const sample = first.body.documents[0];
if (!sample) {
  fail("이 좌표 반경에 음식점이 없습니다. 다른 좌표로 시도해보세요");
} else {
  console.log(`  · 예시: "${sample.category_name}"`);
  const parts = sample.category_name.split(">").map((s) => s.trim());
  if (parts.length >= 2 && parts[0] === "음식점") {
    pass(`"음식점 > 대분류 > ..." 형태 확인 (토큰 ${parts.length}개)`);
  } else {
    fail(`예상과 다릅니다. categories.ts의 파싱을 고쳐야 합니다`);
  }
}

// 4. 45건 상한 + 2번째 토큰 수집
console.log("\n4. 페이징 상한");
const docs = [];
let meta = first.body.meta;
docs.push(...first.body.documents);
for (let page = 2; page <= 3 && !meta.is_end; page++) {
  const next = await fetchPage("FD6", page);
  if (!next.res.ok) {
    fail(`page ${page}에서 HTTP ${next.res.status}`);
    break;
  }
  docs.push(...next.body.documents);
  meta = next.body.meta;
}
console.log(
  `  · total_count ${meta.total_count} / pageable_count ${meta.pageable_count} / 수집 ${docs.length}건`,
);
if (meta.pageable_count <= 45) {
  pass(`pageable_count가 45 이하 — 45건 상한 가정이 맞습니다`);
} else {
  fail(`pageable_count가 ${meta.pageable_count} — 45건 상한 가정이 틀렸습니다. MAX_PAGE를 올릴 수 있습니다`);
}
if (meta.total_count > meta.pageable_count) {
  pass(`실제 ${meta.total_count}건 중 ${meta.pageable_count}건만 조회 가능 → truncated 플래그가 켜져야 하는 상황`);
}

// 5. 카테고리 매핑 커버리지
console.log("\n5. 카테고리 매핑");
const cafe = await fetchPage("CE7", 1);
if (cafe.res.ok) docs.push(...cafe.body.documents);

const tokens = new Map();
for (const d of docs) {
  const t = d.category_name.split(">").map((s) => s.trim())[1] ?? "(없음)";
  tokens.set(t, (tokens.get(t) ?? 0) + 1);
}
const unknown = [...tokens.entries()].filter(([t]) => !KNOWN_TOKENS.has(t));
for (const [t, n] of [...tokens.entries()].sort((a, b) => b[1] - a[1])) {
  const mark = KNOWN_TOKENS.has(t) ? "✓" : "→기타";
  console.log(`  ${mark.padEnd(5)} ${t.padEnd(12)} ${n}건`);
}
if (unknown.length === 0) {
  pass("모든 2번째 토큰이 매핑 테이블에 있습니다");
} else {
  console.log(
    `  · 매핑에 없는 토큰 ${unknown.length}종은 "기타"로 떨어집니다: ${unknown.map(([t]) => t).join(", ")}`,
  );
  console.log("    자주 나오는 값이면 categories.ts의 KAKAO_SECOND_TOKEN에 추가하세요");
}

// 6. 술집 필터
console.log("\n6. 술집 필터");
const excluded = docs.filter((d) =>
  EXCLUDE_TOKENS.some((t) => d.category_name.includes(t)),
);
console.log(`  · ${docs.length}건 중 ${excluded.length}건 제외`);
for (const d of excluded.slice(0, 5)) {
  console.log(`    - ${d.place_name} (${d.category_name})`);
}
if (excluded.length > 0) {
  pass("FD6에 술집이 실제로 섞여 들어옵니다 — 필터가 필요한 게 맞습니다");
} else {
  console.log("  · 이 좌표에는 술집이 없었습니다. 필터 동작은 확인 못 함");
}

// 7. 좌표 필드
console.log("\n7. 좌표 필드");
if (sample) {
  const x = Number.parseFloat(sample.x);
  const y = Number.parseFloat(sample.y);
  if (y > 30 && y < 45 && x > 120 && x < 135) {
    pass(`x=경도(${x}), y=위도(${y}) — 우리 파싱과 일치`);
  } else {
    fail(`x/y가 예상 범위를 벗어납니다: x=${x}, y=${y}. 경도/위도가 뒤바뀐 것일 수 있습니다`);
  }
}

console.log(
  exitCode === 0
    ? "\n전부 통과. 연동 가정이 실물과 맞습니다.\n"
    : "\n실패한 항목이 있습니다. 위 ✗ 표시를 확인하세요.\n",
);
process.exit(exitCode);
