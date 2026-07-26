import { RATE_LIMITS } from "@/lib/config";
import { loadCondition, parseCondition, saveCondition } from "@/lib/group";
import {
  checkRateLimit,
  clientIdentity,
  tooManyRequests,
} from "@/lib/rate-limit";
import { generateRoomCode } from "@/lib/room-code";
import { groupPlayAvailable } from "@/lib/store";

export const dynamic = "force-dynamic";

const MAX_CODE_ATTEMPTS = 5;

/** 방 만들기. 조건(기준점·반경·카테고리)을 저장하고 초대 코드를 돌려줍니다. */
export async function POST(request: Request): Promise<Response> {
  if (!groupPlayAvailable()) {
    return Response.json(
      { error: "그룹 기능이 아직 켜져 있지 않습니다" },
      { status: 503 },
    );
  }

  // 방을 무한히 만들어 스토어를 채우는 걸 막습니다
  const verdict = await checkRateLimit(
    "group-create",
    clientIdentity(request),
    RATE_LIMITS.groupCreate,
  );
  if (!verdict.ok) return tooManyRequests(verdict);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "본문을 읽을 수 없습니다" }, { status: 400 });
  }

  const condition = parseCondition(body);
  if (!condition) {
    return Response.json(
      { error: "기준점·반경·카테고리를 확인해주세요" },
      { status: 400 },
    );
  }

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateRoomCode();
    if (await loadCondition(code)) continue;
    await saveCondition(code, condition);
    return Response.json({ code, condition });
  }

  return Response.json(
    { error: "방 코드를 만들지 못했습니다. 다시 시도해주세요" },
    { status: 500 },
  );
}
