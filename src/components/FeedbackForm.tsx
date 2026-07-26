"use client";

import { useState } from "react";

type Status = "idle" | "sending" | "sent" | "error";

/**
 * 사이트에서 바로 적어 보내는 한마디.
 *
 * mailto는 메일 앱이 없으면 아무 일도 일어나지 않고 주소도 노출됩니다.
 * 여기서 받아 서버가 발송합니다 — 화면에도, 번들에도 주소가 없습니다.
 */
export default function FeedbackForm() {
  const [message, setMessage] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [website, setWebsite] = useState(""); // 봇용 미끼
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const tooShort = message.trim().length < 5;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (tooShort || status === "sending") return;

    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, replyTo, website }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(
          data?.error ??
            (res.status === 429
              ? "잠시 후에 다시 보내주세요."
              : "전송에 실패했습니다."),
        );
        setStatus("error");
        return;
      }
      setMessage("");
      setReplyTo("");
      setStatus("sent");
    } catch {
      setError("네트워크가 불안정합니다. 다시 시도해주세요.");
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div className="feedback-done" role="status">
        <b>보냈습니다. 고맙습니다.</b>
        <p>읽고 반영할 것은 반영하겠습니다.</p>
        <button
          type="button"
          className="btn"
          onClick={() => setStatus("idle")}
        >
          한마디 더 쓰기
        </button>
      </div>
    );
  }

  return (
    <details className="group-disclosure" id="feedback">
      <summary className="group-toggle">
        <span>개발자에게 한마디</span>
        <span className="group-toggle-meta">
          아쉬운 점 · 아이디어
          <span className="chev" aria-hidden="true">
            ›
          </span>
        </span>
      </summary>

      <form className="group-body" onSubmit={submit}>
        <label className="field">
          <span className="field-label">내용</span>
          <textarea
            value={message}
            maxLength={2000}
            rows={4}
            placeholder="무엇이 좋았거나 아쉬웠는지, 있으면 좋겠는 기능을 적어주세요."
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field-label">답장받을 메일 (선택)</span>
          <input
            type="email"
            value={replyTo}
            maxLength={100}
            placeholder="답장이 필요하면 적어주세요"
            autoComplete="email"
            onChange={(e) => setReplyTo(e.target.value)}
          />
        </label>

        {/* 봇용 미끼. 사람에게는 보이지 않습니다 */}
        <input
          type="text"
          className="honeypot"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
        />

        <button
          type="submit"
          className="btn primary block"
          disabled={tooShort || status === "sending"}
        >
          {status === "sending" ? "보내는 중…" : "보내기"}
        </button>

        {error ? <p className="hint warn">{error}</p> : null}

        <p className="hint">
          적은 내용과 브라우저 종류가 함께 전달됩니다. 답장 주소를 비워두면 회신하지
          않습니다.
        </p>
      </form>
    </details>
  );
}
