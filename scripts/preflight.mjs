#!/usr/bin/env node
/**
 * 배포 전 점검. 환경 변수 조합이 만들어내는 동작을 사람이 읽을 수 있게 보여줍니다.
 * 값 자체는 절대 출력하지 않고 "있다/없다"만 알려줍니다.
 *
 *   node scripts/preflight.mjs
 *   vercel env pull .env.local && node scripts/preflight.mjs
 */

import { readFileSync } from "node:fs";

// .env.local이 있으면 읽어 반영합니다 (Next의 로딩 순서를 흉내내는 정도)
for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const [, k, raw] = m;
      if (process.env[k] === undefined) {
        process.env[k] = raw.trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // 파일이 없으면 넘어갑니다
  }
}

const has = (name) => Boolean(process.env[name]?.trim());
const mark = (ok) => (ok ? "설정됨" : "없음  ");

const jsKey = has("NEXT_PUBLIC_KAKAO_JS_KEY");
const restKey = has("KAKAO_REST_KEY");

// Vercel의 Upstash 통합은 버전에 따라 두 가지 이름 중 하나로 주입합니다
const upstashNative =
  has("UPSTASH_REDIS_REST_URL") && has("UPSTASH_REDIS_REST_TOKEN");
const upstashKv = has("KV_REST_API_URL") && has("KV_REST_API_TOKEN");
const upstash = upstashNative || upstashKv;
const upstashNaming = upstashNative
  ? "UPSTASH_REDIS_REST_*"
  : upstashKv
    ? "KV_REST_API_*"
    : null;
const memGroup = process.env.ALLOW_MEMORY_GROUP === "1";
const budget = process.env.KAKAO_DAILY_BUDGET?.trim();

console.log("\n환경 변수");
console.log(`  ${mark(jsKey)}  NEXT_PUBLIC_KAKAO_JS_KEY`);
console.log(`  ${mark(restKey)}  KAKAO_REST_KEY`);
console.log(
  `  ${mark(upstash)}  Upstash Redis${upstashNaming ? ` (${upstashNaming})` : ""}`,
);
if (has("REDIS_URL") && !upstash) {
  console.log("          REDIS_URL만 있습니다 — REST 클라이언트로는 쓸 수 없습니다");
}
console.log(`  ${budget ? "설정됨" : "기본값"}  KAKAO_DAILY_BUDGET${budget ? ` (${budget})` : " (8000)"}`);

const resend = has("RESEND_API_KEY");
console.log(`  ${mark(resend)}  RESEND_API_KEY (개발자에게 한마디 메일 발송)`);
if (resend && !has("FEEDBACK_FROM")) {
  console.log(
    "          FEEDBACK_FROM 미설정 → onboarding@resend.dev 로 발송합니다.",
  );
  console.log(
    "          이 발신자는 Resend 계정 소유자 본인 주소로만 갑니다 (도메인 인증 시 해제).",
  );
}

console.log("\n이 설정으로 배포하면");
console.log(`  지도      ${jsKey ? "카카오맵 타일" : "절차적 캔버스 지도 (샘플)"}`);
console.log(`  식당      ${restKey ? "카카오 로컬 API" : "좌표 시드 샘플 데이터"}`);
console.log(`  POI 캐시  ${upstash ? "Upstash Redis (인스턴스 공유)" : "프로세스 메모리 (인스턴스별)"}`);
console.log(`  Rate limit ${upstash ? "전역" : "인스턴스별 — 서버리스에서 사실상 무력"}`);
console.log(`  그룹      ${upstash ? "동작" : memGroup ? "메모리 (로컬 전용)" : "숨김"}`);
console.log(
  `  한마디    ${resend ? "메일 발송 + Upstash 30일 보관" : "Upstash에만 보관 (lunch:feedback)"}`,
);

const warnings = [];
const errors = [];

if (!jsKey) {
  warnings.push(
    "NEXT_PUBLIC_KAKAO_JS_KEY가 없습니다. 지도가 샘플로 그려집니다.",
  );
}
if (jsKey) {
  warnings.push(
    "카카오 콘솔 [플랫폼 > Web > 사이트 도메인]에 배포 주소를 등록했는지 확인하세요. 안 하면 지도가 뜨지 않습니다.",
  );
}
if (!restKey) {
  warnings.push("KAKAO_REST_KEY가 없습니다. 실제 식당 데이터가 나오지 않습니다.");
}
if (restKey && !upstash) {
  errors.push(
    "REST 키는 있는데 Upstash가 없습니다. 캐시와 rate limit이 인스턴스별로 흩어져서 " +
      "카카오 쿼터를 예상보다 훨씬 빨리 소진하고, 공개 프록시 보호도 무력해집니다.",
  );
}
if (memGroup && process.env.NODE_ENV === "production") {
  errors.push(
    "ALLOW_MEMORY_GROUP이 프로덕션에서 켜져 있습니다. 코드에서 무시하지만 설정을 지우세요.",
  );
}
if (process.env.KAKAO_REST_KEY && process.env.NEXT_PUBLIC_KAKAO_REST_KEY) {
  errors.push(
    "NEXT_PUBLIC_KAKAO_REST_KEY가 존재합니다. REST 키가 브라우저로 노출됩니다. 즉시 삭제하세요.",
  );
}

if (warnings.length) {
  console.log("\n확인");
  for (const w of warnings) console.log(`  · ${w}`);
}
if (errors.length) {
  console.log("\n문제");
  for (const e of errors) console.log(`  ! ${e}`);
}

console.log(
  errors.length ? "\n배포 전에 위 문제를 확인하세요.\n" : "\n배포 가능합니다.\n",
);
process.exit(errors.length ? 1 : 0);
