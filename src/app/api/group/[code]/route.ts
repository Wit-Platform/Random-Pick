import { RATE_LIMITS } from "@/lib/config";
import { loadCondition } from "@/lib/group";
import {
  checkRateLimit,
  clientIdentity,
  tooManyRequests,
} from "@/lib/rate-limit";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/room-code";
import { groupPlayAvailable } from "@/lib/store";

export const dynamic = "force-dynamic";

/** 초대 코드로 방 조건 불러오기. 참가자는 이 조건으로 게임을 시작합니다. */
export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> },
): Promise<Response> {
  if (!groupPlayAvailable()) {
    return Response.json(
      { error: "그룹 기능이 아직 켜져 있지 않습니다" },
      { status: 503 },
    );
  }

  // 코드 무작위 대입(brute force)을 늦춥니다
  const verdict = await checkRateLimit(
    "group-read",
    clientIdentity(request),
    RATE_LIMITS.groupRead,
  );
  if (!verdict.ok) return tooManyRequests(verdict);

  const { code: raw } = await context.params;
  if (!isValidRoomCode(raw)) {
    return Response.json(
      { error: "코드 형식이 올바르지 않습니다" },
      { status: 400 },
    );
  }

  const code = normalizeRoomCode(raw);
  const condition = await loadCondition(code);

  if (!condition) {
    return Response.json(
      { error: "그런 방은 없어요. 코드를 다시 확인해주세요" },
      { status: 404 },
    );
  }

  return Response.json(
    { code, condition },
    { headers: { "Cache-Control": "no-store" } },
  );
}
