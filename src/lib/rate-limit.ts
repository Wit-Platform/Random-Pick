import { getStore } from "./store";

/**
 * 고정 창(fixed window) rate limit.
 *
 * `/api/places`는 인증이 없는 공개 프록시입니다. 배포 URL을 아는 사람은 누구나
 * 우리 카카오 쿼터를 쓸 수 있으므로 IP 단위 상한이 필요합니다.
 *
 * 창 경계에서 최대 2배 버스트가 가능한 방식이지만, 슬라이딩 윈도우를 쓸 만큼
 * 정밀한 제어가 필요한 트래픽이 아닙니다.
 *
 * **저장소가 흔들리면 통과시킵니다(fail-open).** Redis 장애로 점심 게임이
 * 멈추는 것보다 잠깐 보호가 느슨해지는 편이 낫습니다.
 */

export interface RateLimitVerdict {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
}

export interface RateLimitRule {
  limit: number;
  windowSec: number;
}

export async function checkRateLimit(
  bucket: string,
  identity: string,
  rule: RateLimitRule,
): Promise<RateLimitVerdict> {
  const { limit, windowSec } = rule;
  const nowSec = Math.floor(Date.now() / 1000);
  const window = Math.floor(nowSec / windowSec);
  const key = `lunch:rl:${bucket}:${identity}:${window}`;
  const retryAfterSec = windowSec - (nowSec % windowSec);

  try {
    const store = getStore();
    const count = await store.incr(key);
    if (count === 1) await store.expire(key, windowSec);
    return {
      ok: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      retryAfterSec,
    };
  } catch (err) {
    console.warn(`[rate-limit] ${bucket} 확인 실패, 통과시킵니다:`, err);
    return { ok: true, limit, remaining: limit, retryAfterSec };
  }
}

/**
 * 요청자 식별. Vercel은 `x-forwarded-for`를 채워주며 첫 항목이 실제 클라이언트입니다.
 * 헤더는 위조 가능하므로 보안 경계가 아니라 사고 방지용 상한으로만 씁니다.
 */
export function clientIdentity(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function tooManyRequests(verdict: RateLimitVerdict): Response {
  return Response.json(
    {
      error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요",
      retryAfterSec: verdict.retryAfterSec,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(verdict.retryAfterSec),
        "X-RateLimit-Limit": String(verdict.limit),
        "X-RateLimit-Remaining": "0",
      },
    },
  );
}
