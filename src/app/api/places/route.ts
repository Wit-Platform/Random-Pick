import { ALL_CATEGORY_IDS, groupCodesFor } from "@/lib/categories";
import { PREVIEW_LIMIT, RATE_LIMITS } from "@/lib/config";
import { distanceM } from "@/lib/geo";
import { loadRawPlaces } from "@/lib/places-source";
import {
  checkRateLimit,
  clientIdentity,
  tooManyRequests,
} from "@/lib/rate-limit";
import type { CategoryId, LatLng } from "@/lib/types";

export const dynamic = "force-dynamic";

const MIN_RADIUS = 50;
const MAX_RADIUS = 20_000;
const MAX_LIMIT = 200;

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

/**
 * 누락된 파라미터를 0으로 읽지 않도록 명시적으로 걸러냅니다.
 * `Number(null)`은 0이고 0은 유효한 위도라서, 검사를 빼면 좌표를 안 보낸 요청이
 * 조용히 (0, 0)을 조회하게 됩니다.
 */
function requireNumber(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** 파라미터 부재 = 전체 선택, 빈 값 = 선택 없음. 둘은 다릅니다. */
function parseCats(raw: string | null): CategoryId[] {
  if (raw === null) return [...ALL_CATEGORY_IDS];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((c): c is CategoryId =>
      (ALL_CATEGORY_IDS as readonly string[]).includes(c),
    );
}

/**
 * 후보 조회. 프리뷰(기준점 중심 넓은 반경)와 리빌 판정(착지점 중심 좁은 반경)이
 * 같은 엔드포인트를 씁니다. 응답은 항상 요청 좌표로부터 거리 오름차순이라,
 * 리빌에서는 첫 번째 항목이 곧 최근접 당첨입니다.
 */
export async function GET(request: Request): Promise<Response> {
  // 인증 없는 공개 프록시라 IP 상한이 유일한 방어선입니다
  const verdict = await checkRateLimit(
    "places",
    clientIdentity(request),
    RATE_LIMITS.places,
  );
  if (!verdict.ok) return tooManyRequests(verdict);

  const params = new URL(request.url).searchParams;

  const lat = requireNumber(params.get("lat"));
  const lng = requireNumber(params.get("lng"));
  if (lat === null || lat < -90 || lat > 90) {
    return badRequest("lat이 올바르지 않습니다");
  }
  if (lng === null || lng < -180 || lng > 180) {
    return badRequest("lng이 올바르지 않습니다");
  }

  const radiusRaw = requireNumber(params.get("radius"));
  if (radiusRaw === null) return badRequest("radius가 올바르지 않습니다");
  const radiusM = Math.min(Math.max(radiusRaw, MIN_RADIUS), MAX_RADIUS);

  const cats = parseCats(params.get("cats"));
  if (cats.length === 0) {
    return Response.json({ places: [], source: "sample", truncated: false });
  }

  const limitRaw = requireNumber(params.get("limit"));
  const limit =
    limitRaw === null
      ? PREVIEW_LIMIT
      : Math.min(Math.max(Math.trunc(limitRaw), 1), MAX_LIMIT);

  const center: LatLng = { lat, lng };
  const raw = await loadRawPlaces(center, radiusM, groupCodesFor(cats));

  const allowed = new Set<CategoryId>(cats);
  const ranked = raw.places
    .filter((p) => allowed.has(p.cat))
    .map((place) => ({ place, dist: distanceM(center, place) }))
    .filter((entry) => entry.dist <= radiusM)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit);

  return Response.json(
    {
      places: ranked.map((entry) => ({
        ...entry.place,
        dist: Math.round(entry.dist),
      })),
      source: raw.source,
      truncated: raw.truncated,
      reason: raw.reason,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-RateLimit-Limit": String(verdict.limit),
        "X-RateLimit-Remaining": String(verdict.remaining),
      },
    },
  );
}
