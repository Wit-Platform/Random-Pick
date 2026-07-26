import { RATE_LIMITS } from "@/lib/config";
import { parseFeedback, submitFeedback, type FeedbackError } from "@/lib/feedback";
import {
  checkRateLimit,
  clientIdentity,
  tooManyRequests,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MESSAGES: Record<FeedbackError, string> = {
  empty: "내용을 적어주세요.",
  "too-short": "조금만 더 자세히 적어주세요.",
  "too-long": "2000자 안으로 줄여주세요.",
  "bad-reply-to": "답장받을 메일 주소를 다시 확인해주세요.",
  // 미끼 필드에 걸린 요청. 봇에게 이유를 알려줄 필요는 없습니다
  spam: "전송하지 못했습니다.",
};

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "내용을 읽을 수 없습니다." }, { status: 400 });
  }

  /**
   * 검증을 rate limit보다 먼저 합니다.
   *
   * 순서를 반대로 두면 메일 주소를 한 번 잘못 적은 것만으로 할당량이 소진되어,
   * 정작 할 말이 있는 사람이 막힙니다. 검증에 걸린 요청은 메일을 보내지 않으므로
   * 비용이 없고, 보호해야 하는 건 발송 경로입니다.
   */
  const parsed = parseFeedback(body, request.headers.get("user-agent"));
  if (!parsed.ok) {
    return Response.json({ error: MESSAGES[parsed.error] }, { status: 400 });
  }

  const verdict = await checkRateLimit(
    "feedback",
    clientIdentity(request),
    RATE_LIMITS.feedback,
  );
  if (!verdict.ok) return tooManyRequests(verdict);

  let result: { stored: boolean; emailed: boolean };
  try {
    result = await submitFeedback(parsed.value);
  } catch {
    return Response.json(
      { error: "전송에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 },
    );
  }

  /**
   * `emailed`를 응답에 담습니다.
   *
   * 보낸 사람에게는 어느 쪽이든 "접수됨"이 맞지만, 이게 없으면 **운영자가 메일 발송이
   * 망가진 것을 알 방법이 없습니다** — 내용은 Redis에 조용히 쌓이기만 합니다.
   * 설정 여부를 노출하는 것 외에 민감한 정보는 없고, 브라우저 네트워크 탭에서
   * 바로 확인할 수 있게 하는 값이 훨씬 큽니다.
   */
  return Response.json(
    { ok: true, ...result },
    { headers: { "Cache-Control": "no-store" } },
  );
}
