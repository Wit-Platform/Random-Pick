import { RATE_LIMITS } from "@/lib/config";
import { castVote, loadCondition, sanitizeVoterId } from "@/lib/group";
import {
  checkRateLimit,
  clientIdentity,
  tooManyRequests,
} from "@/lib/rate-limit";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/room-code";
import { groupPlayAvailable } from "@/lib/store";
import type { VoteValue } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 붐업 / 붐따.
 *
 * 계정이 없으므로 투표자는 브라우저가 만든 임의 식별자로 구분합니다. 같은 사람이
 * 브라우저를 바꾸면 다시 투표할 수 있습니다 — 점심 정하는 투표라 그 정도면 충분하고,
 * 엄격한 1인 1표를 보장하려면 로그인이 필요합니다.
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
  const code = normalizeRoomCode(raw);
  if (!(await loadCondition(code))) {
    return Response.json(
      { error: "만료되거나 존재하지 않는 방입니다" },
      { status: 404 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "본문을 읽을 수 없습니다" }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;

  const entryId = typeof b.entryId === "string" ? b.entryId.trim() : "";
  if (!/^[A-Za-z0-9]{4,32}$/.test(entryId)) {
    return Response.json({ error: "잘못된 항목입니다" }, { status: 400 });
  }

  const voterId = sanitizeVoterId(b.voterId);
  if (!voterId) {
    return Response.json({ error: "투표자 식별자가 없습니다" }, { status: 400 });
  }

  if (b.value !== "up" && b.value !== "down") {
    return Response.json({ error: "잘못된 투표입니다" }, { status: 400 });
  }

  const result = await castVote(code, entryId, voterId, b.value as VoteValue);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
