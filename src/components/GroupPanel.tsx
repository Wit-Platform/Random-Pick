"use client";

import { useState } from "react";

import { categoryLabel } from "@/lib/categories";
import { GROUP } from "@/lib/config";
import { formatDistance } from "@/lib/geo";
import type { GroupMember } from "@/lib/group";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/room-code";
import type { CategoryId, GroupThrowWithVotes, VoteValue } from "@/lib/types";

export interface GroupPanelProps {
  code: string | null;
  nick: string;
  busy: boolean;
  error: string | null;
  expired: boolean;
  feed: GroupThrowWithVotes[];
  members: GroupMember[];
  /** 방을 만든 사람만 잠글 수 있습니다 */
  isOwner: boolean;
  locked: boolean;
  radiusM: number;
  cats: CategoryId[];
  onNick: (value: string) => void;
  onCreate: () => void;
  onJoin: (code: string) => void;
  onLeave: () => void;
  onVote: (entryId: string, value: VoteValue) => void;
  onRemove: (entryId: string) => void;
  onToggleLock: (locked: boolean) => void;
}

function relativeTime(ts: number): string {
  const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diffSec < 60) return "방금";
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min}분 전`;
  return `${Math.round(min / 60)}시간 전`;
}

export default function GroupPanel(props: GroupPanelProps) {
  const { code, nick, busy, error, expired, feed, members, isOwner, locked } =
    props;
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [codeShown, setCodeShown] = useState(false);

  const nickReady = nick.trim().length > 0;
  const inputCode = normalizeRoomCode(input);
  const canJoin = nickReady && isValidRoomCode(inputCode) && !busy;

  async function copy(kind: "code" | "link") {
    if (!code) return;
    const text =
      kind === "code" ? code : `${window.location.origin}/?room=${code}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      // 클립보드 권한이 없으면 코드를 눌러 드러낸 뒤 직접 읽어 쓰면 됩니다
    }
  }

  return (
    // 컨트롤이 쌓이면 그룹 섹션이 패널 스크롤 아래로 묻혀서 없는 기능처럼 보입니다.
    // 접어두면 한 줄로 줄어들어 스크롤 없이도 눈에 들어옵니다.
    <details className="group-disclosure" open={code ? true : undefined}>
      <summary className="group-toggle">
        <span>
          {code ? (
            <>
              그룹 {locked ? "🔒" : ""}
              <b className="group-toggle-code"> {code}</b>
            </>
          ) : (
            "그룹으로 같이 던지기"
          )}
        </span>
        <span className="group-toggle-meta">
          {code
            ? `${members.length}명 · 결과 ${feed.length}`
            : "방 만들기 · 참가"}
          <span className="chev" aria-hidden="true">
            ›
          </span>
        </span>
      </summary>

      <div className="group-body">
        <label className="field">
          <span className="field-label">닉네임</span>
          <input
            type="text"
            value={nick}
            maxLength={GROUP.maxNickLength}
            placeholder="그룹원에게 보일 이름"
            onChange={(e) => props.onNick(e.target.value)}
          />
        </label>

        {code ? (
          <>
            {/* 코드는 기본으로 가려둡니다 — 스크린샷·어깨너머 노출을 줄입니다 */}
            <div className="room-code">
              <button
                type="button"
                className={`room-code-value${codeShown ? "" : " masked"}`}
                onClick={() => setCodeShown((v) => !v)}
                aria-label={codeShown ? "코드 가리기" : "코드 보기"}
                title={codeShown ? "가리기" : "보기"}
              >
                {codeShown ? code : "••••••"}
              </button>
              <button type="button" className="btn" onClick={() => copy("code")}>
                {copied === "code" ? "복사됨" : "코드 복사"}
              </button>
              <button type="button" className="btn" onClick={() => copy("link")}>
                {copied === "link" ? "복사됨" : "링크 복사"}
              </button>
            </div>

            {/* 참가자 — 결정한 사람이 없어도 방에 누가 있는지는 보여야 합니다 */}
            <div className="members">
              <span className="field-label">
                지금 방에 {members.length}명
              </span>
              {members.length > 0 ? (
                <div className="member-chips">
                  {members.map((m, i) => (
                    <span
                      key={`${m.nick}-${i}`}
                      className={`member${m.self ? " self" : ""}`}
                    >
                      {m.nick}
                      {m.self ? " (나)" : ""}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="hint">참가자를 확인하는 중…</p>
              )}
            </div>

            <p className="hint">
              반경 {formatDistance(props.radiusM)} ·{" "}
              {props.cats.length === 0
                ? "종류 미선택"
                : props.cats.map(categoryLabel).join(", ")}
            </p>

            {isOwner ? (
              <button
                type="button"
                className={`btn block${locked ? " on" : ""}`}
                onClick={() => props.onToggleLock(!locked)}
              >
                {locked ? "🔒 잠김 — 새 참가 허용하기" : "새 참가 막기"}
              </button>
            ) : locked ? (
              <p className="hint">방장이 새 참가를 막아둔 상태입니다.</p>
            ) : null}

            {expired ? (
              <p className="hint warn">방이 만료됐습니다. 새로 만들어주세요.</p>
            ) : null}

            {feed.length > 0 ? (
              <div className="feed">
                {[...feed].reverse().map((entry) => (
                  <div className="feed-item" key={entry.id}>
                    <div className="feed-main">
                      <span className="feed-place">
                        <b>{entry.nick}</b>{" "}
                        {entry.url ? (
                          <a
                            href={entry.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="feed-link"
                          >
                            {entry.placeName} ↗
                          </a>
                        ) : (
                          entry.placeName
                        )}
                      </span>
                      <span className="num">
                        {categoryLabel(entry.cat)} ·{" "}
                        {formatDistance(entry.distM)} · {relativeTime(entry.ts)}
                      </span>
                    </div>

                    <div className="vote">
                      <button
                        type="button"
                        className={`vote-btn${entry.myVote === "up" ? " on up" : ""}`}
                        onClick={() => props.onVote(entry.id, "up")}
                        aria-pressed={entry.myVote === "up"}
                        aria-label={`${entry.placeName} 붐업`}
                        title="붐업"
                      >
                        <span aria-hidden="true">👍</span>
                        <span className="vote-count">{entry.up}</span>
                      </button>
                      <button
                        type="button"
                        className={`vote-btn${entry.myVote === "down" ? " on down" : ""}`}
                        onClick={() => props.onVote(entry.id, "down")}
                        aria-pressed={entry.myVote === "down"}
                        aria-label={`${entry.placeName} 붐따`}
                        title="붐따"
                      >
                        <span aria-hidden="true">👎</span>
                        <span className="vote-count">{entry.down}</span>
                      </button>
                      {entry.mine ? (
                        <button
                          type="button"
                          className="vote-btn remove"
                          onClick={() => props.onRemove(entry.id)}
                          aria-label={`${entry.placeName} 내리기`}
                          title="내리기"
                        >
                          ✕
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="hint">
                아직 결정한 사람이 없습니다. 먼저 던져보세요.
              </p>
            )}

            <button type="button" className="btn block" onClick={props.onLeave}>
              방 나가기
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn block"
              onClick={props.onCreate}
              disabled={!nickReady || busy}
            >
              {busy ? "만드는 중…" : "방 만들기"}
            </button>

            <div className="join">
              <input
                type="text"
                value={input}
                maxLength={GROUP.codeLength + 2}
                placeholder="초대 코드"
                spellCheck={false}
                autoCapitalize="characters"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canJoin) props.onJoin(inputCode);
                }}
                aria-label="초대 코드"
              />
              <button
                type="button"
                className="btn"
                onClick={() => props.onJoin(inputCode)}
                disabled={!canJoin}
              >
                참가
              </button>
            </div>

            {!nickReady ? (
              <p className="hint">먼저 닉네임을 입력해주세요.</p>
            ) : null}
          </>
        )}

        {error ? <p className="hint warn">{error}</p> : null}
      </div>
    </details>
  );
}
