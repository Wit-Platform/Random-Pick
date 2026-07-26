import { ALL_CATEGORY_IDS } from "@/lib/categories";
import { RATE_LIMITS } from "@/lib/config";
import {
  appendThrow,
  loadCondition,
  loadThrows,
  sanitizeNick,
} from "@/lib/group";
import {
  checkRateLimit,
  clientIdentity,
  tooManyRequests,
  type RateLimitRule,
} from "@/lib/rate-limit";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/room-code";
import { groupPlayAvailable } from "@/lib/store";
import type { CategoryId, GroupThrow } from "@/lib/types";

export const dynamic = "force-dynamic";

async function resolveCode(
  request: Request,
  context: { params: Promise<{ code: string }> },
  rule: RateLimitRule,
  bucket: string,
): Promise<{ code: string } | Response> {
  if (!groupPlayAvailable()) {
    return Response.json(
      { error: "그룹 기능이 아직 켜져 있지 않습니다" },
      { status: 503 },
    );
  }

  const verdict = await checkRateLimit(bucket, clientIdentity(request), rule);
  if (!verdict.ok) return tooManyRequests(verdict);

  const { code: raw } = await context.params;
  if (!isValidRoomCode(raw)) {
    return Response.json(
      { error: "코드 형식이 올바르지 않습니다" },
      { status: 400 },
    );
  }

  const code = normalizeRoomCode(raw);
  if (!(await loadCondition(code))) {
    return Response.json(
      { error: "만료되거나 존재하지 않는 방입니다" },
      { status: 404 },
    );
  }

  return { code };
}

/** 그룹 결과 피드. 클라이언트는 5초 간격으로 폴링합니다. */
export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> },
): Promise<Response> {
  const resolved = await resolveCode(
    request,
    context,
    RATE_LIMITS.groupRead,
    "group-read",
  );
  if (resolved instanceof Response) return resolved;

  return Response.json(
    { throws: await loadThrows(resolved.code) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** "이걸로 결정"을 누른 결과만 기록합니다. 던질 때마다 자동 전송하지 않습니다. */
export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> },
): Promise<Response> {
  const resolved = await resolveCode(
    request,
    context,
    RATE_LIMITS.groupWrite,
    "group-write",
  );
  if (resolved instanceof Response) return resolved;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "본문을 읽을 수 없습니다" }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const nick = sanitizeNick(b.nick);
  if (!nick) {
    return Response.json({ error: "닉네임을 입력해주세요" }, { status: 400 });
  }

  const placeName = typeof b.placeName === "string" ? b.placeName.trim() : "";
  if (!placeName) {
    return Response.json({ error: "식당 정보가 없습니다" }, { status: 400 });
  }

  const cat = (ALL_CATEGORY_IDS as readonly string[]).includes(b.cat as string)
    ? (b.cat as CategoryId)
    : "et";

  const distRaw = Number(b.distM);
  const entry: GroupThrow = {
    nick,
    placeName: placeName.slice(0, 40),
    cat,
    distM: Number.isFinite(distRaw) ? Math.round(distRaw) : 0,
    ts: Date.now(),
  };

  await appendThrow(resolved.code, entry);
  return Response.json({ ok: true, entry });
}
