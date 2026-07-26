import {
  categoryFromKakao,
  detailFromKakao,
  isExcludedByCategory,
} from "./categories";
import { KAKAO_GUARD } from "./config";
import { mockPlaces } from "./mock-places";
import { getStore } from "./store";
import type { LatLng, Place, PlacesResult, SampleReason } from "./types";

/**
 * 서버 전용. 카카오 로컬 API를 호출하고, 실패하면 샘플 데이터로 조용히 넘어갑니다.
 * REST 키가 브라우저로 나가지 않도록 이 모듈은 절대 클라이언트에서 import하지 마세요.
 */

const ENDPOINT = "https://dapi.kakao.com/v2/local/search/category.json";

/** 카카오는 검색당 size 15 × page 3 = 45건이 상한입니다 */
const PAGE_SIZE = 15;
const MAX_PAGE = 3;
const KAKAO_MAX_RADIUS = 20_000;
const CACHE_TTL_SEC = 600;
const FETCH_TIMEOUT_MS = 4_000;
const BUDGET_TTL_SEC = 2 * 24 * 3600;

const COOLDOWN_KEY = "lunch:kakao:cooldown";

class KakaoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface KakaoDoc {
  id: string;
  place_name: string;
  category_name: string;
  category_group_code: string;
  x: string;
  y: string;
  place_url: string;
  address_name: string;
  road_address_name: string;
}

interface KakaoResponse {
  documents: KakaoDoc[];
  meta: { total_count: number; pageable_count: number; is_end: boolean };
}

function toPlace(doc: KakaoDoc): Place | null {
  if (isExcludedByCategory(doc.category_name)) return null;
  const lat = Number.parseFloat(doc.y);
  const lng = Number.parseFloat(doc.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    id: doc.id,
    name: doc.place_name,
    cat: categoryFromKakao(doc.category_name),
    detail: detailFromKakao(doc.category_name),
    lat,
    lng,
    url: doc.place_url || undefined,
    road: doc.road_address_name || doc.address_name || undefined,
  };
}

/* ── 쿼터 보호 ─────────────────────────────────────────── */

function dailyBudget(): number {
  const raw = Number(process.env.KAKAO_DAILY_BUDGET);
  return Number.isFinite(raw) && raw > 0 ? raw : KAKAO_GUARD.defaultDailyBudget;
}

/** 예산 카운터는 KST 날짜로 끊습니다 — 점심 시간대에 초기화가 걸치지 않도록 */
function budgetKey(): string {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return `lunch:kakao:calls:${kst.toISOString().slice(0, 10)}`;
}

/**
 * 카카오를 호출해도 되는지. 예산 초과나 쿨다운 중이면 샘플로 내려앉습니다.
 * 상태 조회 자체가 실패하면 호출을 허용합니다 — 보호 장치가 게임을 막으면 안 됩니다.
 */
async function kakaoGate(): Promise<{ ok: true } | { ok: false; reason: SampleReason }> {
  try {
    const store = getStore();
    if (await store.get(COOLDOWN_KEY)) return { ok: false, reason: "cooldown" };
    const used = Number((await store.get(budgetKey())) ?? 0);
    if (used >= dailyBudget()) return { ok: false, reason: "budget" };
    return { ok: true };
  } catch (err) {
    console.warn("[places] 쿼터 상태 확인 실패, 호출을 허용합니다:", err);
    return { ok: true };
  }
}

async function noteCalls(count: number): Promise<void> {
  if (count <= 0) return;
  try {
    const store = getStore();
    const key = budgetKey();
    const total = await store.incr(key, count);
    // 방금 만들어진 카운터라면 만료를 걸어둡니다 (자체 정리)
    if (total <= count) await store.expire(key, BUDGET_TTL_SEC);
  } catch {
    // 카운트 실패로 요청을 되돌릴 수는 없습니다
  }
}

async function tripCooldown(seconds: number): Promise<void> {
  try {
    await getStore().set(COOLDOWN_KEY, String(Date.now()), seconds);
  } catch {
    // 쿨다운을 못 걸면 다음 요청이 다시 시도할 뿐입니다
  }
}

/* ── 카카오 조회 ───────────────────────────────────────── */

async function fetchGroupCode(
  key: string,
  center: LatLng,
  radiusM: number,
  code: string,
): Promise<{ places: Place[]; truncated: boolean; calls: number }> {
  const places: Place[] = [];
  let truncated = false;
  let calls = 0;

  for (let page = 1; page <= MAX_PAGE; page++) {
    const params = new URLSearchParams({
      category_group_code: code,
      x: String(center.lng),
      y: String(center.lat),
      radius: String(Math.min(Math.round(radiusM), KAKAO_MAX_RADIUS)),
      sort: "distance",
      size: String(PAGE_SIZE),
      page: String(page),
    });

    const res = await fetch(`${ENDPOINT}?${params}`, {
      headers: { Authorization: `KakaoAK ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    calls++;

    if (!res.ok) {
      throw new KakaoApiError(
        `kakao local ${code} p${page}: ${res.status}`,
        res.status,
      );
    }

    const data = (await res.json()) as KakaoResponse;
    for (const doc of data.documents) {
      const place = toPlace(doc);
      if (place) places.push(place);
    }

    // 실제 개수가 페이징 상한을 넘으면 프리뷰는 표본일 뿐임을 알려야 합니다
    if (data.meta.total_count > data.meta.pageable_count) truncated = true;
    if (data.meta.is_end) break;
    if (page === MAX_PAGE && !data.meta.is_end) truncated = true;
  }

  return { places, truncated, calls };
}

/**
 * 캐시 키의 좌표 정밀도. 좁은 반경(리빌 판정)에서는 11m 격자,
 * 넓은 반경(프리뷰)에서는 111m 격자로 캐시 적중률을 올립니다.
 */
function cacheKey(center: LatLng, radiusM: number, codes: string[]): string {
  const precision = radiusM <= 600 ? 4 : 3;
  const lat = center.lat.toFixed(precision);
  const lng = center.lng.toFixed(precision);
  const bucket = Math.round(radiusM / 100) * 100;
  return `lunch:poi:${lat}:${lng}:${bucket}:${codes.join("+")}`;
}

function sample(
  center: LatLng,
  radiusM: number,
  reason: SampleReason,
): PlacesResult {
  return {
    places: mockPlaces(center, radiusM),
    source: "sample",
    truncated: false,
    reason,
  };
}

/**
 * 카테고리 필터 이전의 원본 후보를 가져옵니다. 캐시는 필터 전 상태로 저장하므로
 * 같은 위치에서 카테고리만 바꿔도 재요청이 없습니다.
 */
export async function loadRawPlaces(
  center: LatLng,
  radiusM: number,
  codes: string[],
): Promise<PlacesResult> {
  const key = process.env.KAKAO_REST_KEY;
  if (!key || codes.length === 0) return sample(center, radiusM, "no-key");

  const store = getStore();
  const ck = cacheKey(center, radiusM, codes);

  try {
    const hit = await store.get(ck);
    if (hit) return JSON.parse(hit) as PlacesResult;
  } catch {
    // 캐시 실패는 조용히 무시하고 원본을 조회합니다
  }

  // 캐시 미스일 때만 예산을 확인합니다 — 캐시 히트는 쿼터를 쓰지 않으므로
  const gate = await kakaoGate();
  if (!gate.ok) return sample(center, radiusM, gate.reason);

  try {
    const results = await Promise.all(
      codes.map((code) => fetchGroupCode(key, center, radiusM, code)),
    );

    await noteCalls(results.reduce((sum, r) => sum + r.calls, 0));

    const byId = new Map<string, Place>();
    let truncated = false;
    for (const r of results) {
      truncated = truncated || r.truncated;
      for (const p of r.places) byId.set(p.id, p);
    }

    const payload: PlacesResult = {
      places: [...byId.values()],
      source: "kakao",
      truncated,
    };

    try {
      await store.set(ck, JSON.stringify(payload), CACHE_TTL_SEC);
    } catch {
      // 캐시 쓰기 실패도 치명적이지 않습니다
    }

    return payload;
  } catch (err) {
    const status = err instanceof KakaoApiError ? err.status : 0;

    // 429는 한도에 걸린 것이므로 한동안 아예 건드리지 않습니다.
    // 나머지 오류(타임아웃·5xx)는 짧게만 끊습니다.
    if (status === 429) {
      await tripCooldown(KAKAO_GUARD.rateLimitCooldownSec);
      console.warn("[places] 카카오 429 — 쿨다운 진입");
      return sample(center, radiusM, "cooldown");
    }

    await tripCooldown(KAKAO_GUARD.errorCooldownSec);
    console.warn("[places] 카카오 조회 실패, 샘플 데이터로 폴백:", err);
    return sample(center, radiusM, "error");
  }
}
