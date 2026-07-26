import { CONTACT_EMAIL, SITE } from "./site";
import { getStore } from "./store";

/**
 * 서버 전용. 사이트에서 받은 한마디를 저장하고 메일로 보냅니다.
 *
 * **저장을 먼저, 발송은 그다음입니다.** 메일 제공자가 설정돼 있지 않거나 장애가 나도
 * 사용자가 쓴 내용이 사라지면 안 됩니다. 발송이 실패해도 접수는 성공으로 응답하고,
 * 남은 메시지는 Upstash 콘솔에서 `lunch:feedback` 리스트로 읽을 수 있습니다.
 */

const MESSAGE_MIN = 5;
const MESSAGE_MAX = 2000;
const REPLY_MAX = 100;
const UA_MAX = 180;
const FEEDBACK_KEY = "lunch:feedback";
/** 30일. 메일이 안 나갔더라도 확인할 시간을 둡니다 */
const FEEDBACK_TTL_SEC = 30 * 24 * 3600;
const MAX_STORED = 500;

export interface FeedbackInput {
  message: string;
  replyTo: string | null;
  userAgent: string | null;
}

export type FeedbackError =
  | "empty"
  | "too-short"
  | "too-long"
  | "bad-reply-to"
  | "spam";

export function parseFeedback(
  body: unknown,
  userAgent: string | null,
): { ok: true; value: FeedbackInput } | { ok: false; error: FeedbackError } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "empty" };
  const b = body as Record<string, unknown>;

  // 봇이 자동으로 채우는 미끼 필드. 사람에게는 보이지 않습니다
  if (typeof b.website === "string" && b.website.trim() !== "") {
    return { ok: false, error: "spam" };
  }

  const message = typeof b.message === "string" ? b.message.trim() : "";
  if (message.length === 0) return { ok: false, error: "empty" };
  if (message.length < MESSAGE_MIN) return { ok: false, error: "too-short" };
  if (message.length > MESSAGE_MAX) return { ok: false, error: "too-long" };

  let replyTo: string | null = null;
  if (typeof b.replyTo === "string" && b.replyTo.trim() !== "") {
    const candidate = b.replyTo.trim();
    // 엄격한 검증은 불가능하고 불필요합니다 — 답장 주소를 잘못 적는 건 본인 몫입니다
    if (candidate.length > REPLY_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
      return { ok: false, error: "bad-reply-to" };
    }
    replyTo = candidate;
  }

  return {
    ok: true,
    value: {
      message,
      replyTo,
      userAgent: userAgent ? userAgent.slice(0, UA_MAX) : null,
    },
  };
}

async function store(input: FeedbackInput): Promise<void> {
  const s = getStore();
  await s.rpush(
    FEEDBACK_KEY,
    JSON.stringify({ ...input, ts: new Date().toISOString() }),
  );
  await s.ltrim(FEEDBACK_KEY, -MAX_STORED, -1);
  await s.expire(FEEDBACK_KEY, FEEDBACK_TTL_SEC);
}

function kstNow(): string {
  return new Date(Date.now() + 9 * 3600 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 16);
}

async function send(input: FeedbackInput): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;

  const to = process.env.FEEDBACK_TO?.trim() || CONTACT_EMAIL;
  // 도메인을 인증하지 않았다면 Resend의 테스트 발신자를 쓸 수 있습니다.
  // 이 경우 계정 소유자 본인 주소로만 발송됩니다.
  const from = process.env.FEEDBACK_FROM?.trim() || "onboarding@resend.dev";

  const lines = [
    input.message,
    "",
    "─────────────",
    `받은 시각: ${kstNow()} (KST)`,
    `답장 주소: ${input.replyTo ?? "(없음)"}`,
    `브라우저: ${input.userAgent ?? "(없음)"}`,
  ];

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${SITE.name} <${from}>`,
        to: [to],
        subject: `[${SITE.name}] 개발자에게 한마디`,
        text: lines.join("\n"),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      console.warn("[feedback] 발송 실패:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[feedback] 발송 오류:", err);
    return false;
  }
}

/** 저장을 먼저 하고 발송을 시도합니다. 발송 실패도 접수 성공으로 봅니다. */
export async function submitFeedback(input: FeedbackInput): Promise<{
  stored: boolean;
  emailed: boolean;
}> {
  let stored = false;
  try {
    await store(input);
    stored = true;
  } catch (err) {
    console.warn("[feedback] 저장 실패:", err);
  }

  const emailed = await send(input);

  if (!stored && !emailed) {
    throw new Error("feedback: 저장과 발송이 모두 실패했습니다");
  }
  return { stored, emailed };
}
