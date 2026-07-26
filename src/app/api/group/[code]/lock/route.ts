import { RATE_LIMITS } from "@/lib/config";
import { sanitizeVoterId, setRoomLocked } from "@/lib/group";
import {
  checkRateLimit,
  clientIdentity,
  tooManyRequests,
} from "@/lib/rate-limit";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/room-code";
import { groupPlayAvailable } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * 방 잠그기 / 풀기. **만든 사람만** 바꿀 수 있습니다.
 *
 * 6자리 코드는 32^6 ≈ 10.7억 조합이고 조회에 IP 상한이 걸려 있어 무작위 참가는
 * 사실상 불가능합니다. 실제 위험은 코드가 유출되는 것이므로, 인원이 모인 뒤
 * 새 참가를 막는 수단을 둡니다. 이미 들어온 사람은 영향을 받지 않습니다.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> },
): Promise<Response> {
  if (!groupPlayAvailable()) {
    return Response.json(
      { error: "그룹 기능이 아직 켜져 있지 않습니다" },
      { status: 503 },
    );
  }

  const verdict = await checkRateLimit(
    "group-write",
    clientIdentity(request),
    RATE_LIMITS.groupWrite,
  );
  if (!verdict.ok) return tooManyRequests(verdict);

  const { code: raw } = await context.params;
  if (!isValidRoomCode(raw)) {
    return Response.json({ error: "코드 형식이 올바르지 않습니다" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "본문을 읽을 수 없습니다" }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const voterId = sanitizeVoterId(b.voterId);
  if (!voterId || typeof b.locked !== "boolean") {
    return Response.json({ error: "잘못된 요청입니다" }, { status: 400 });
  }

  const result = await setRoomLocked(normalizeRoomCode(raw), voterId, b.locked);
  if (result === "missing") {
    return Response.json(
      { error: "만료되거나 존재하지 않는 방입니다" },
      { status: 404 },
    );
  }
  if (result === "forbidden") {
    return Response.json(
      { error: "방을 만든 사람만 잠글 수 있습니다" },
      { status: 403 },
    );
  }

  return Response.json(
    { ok: true, locked: b.locked },
    { headers: { "Cache-Control": "no-store" } },
  );
}
