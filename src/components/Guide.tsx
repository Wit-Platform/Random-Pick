"use client";

import { useEffect, useRef } from "react";

/**
 * 처음 열었을 때 한 번 보여주는 사용법.
 *
 * 가장 헷갈리는 건 **당긴 반대 방향으로 날아간다**는 점이라, 글로 설명하지 않고
 * 그림으로 보여줍니다. 새총을 떠올리면 되는데 그 연결이 안 되면 아무리 읽어도
 * 이해가 안 됩니다.
 */
export interface GuideProps {
  onClose: () => void;
}

export default function Guide({ onClose }: GuideProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="guide-scrim" role="dialog" aria-modal="true" aria-label="사용법">
      <div className="guide">
        <h2 className="guide-title">돌을 던져서 점심을 정합니다</h2>

        <ol className="guide-steps">
          <li>
            <span className="guide-num">1</span>
            <div>
              <b>기준점을 정합니다</b>
              <p>현재 위치를 쓰거나, 지도를 탭해서 직접 찍습니다.</p>
            </div>
          </li>

          <li>
            <span className="guide-num">2</span>
            <div>
              <b>당겼다 놓습니다</b>
              <p>
                새총처럼 <b>당긴 반대 방향</b>으로 날아갑니다. 세게 당기면 멀리 갑니다.
              </p>

              {/* 방향이 뒤집힌다는 것을 그림으로 */}
              <div className="guide-diagram" aria-hidden="true">
                <svg viewBox="0 0 240 120" role="presentation">
                  <defs>
                    <marker
                      id="guide-arrow"
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="5"
                      markerHeight="5"
                      orient="auto-start-reverse"
                    >
                      <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
                    </marker>
                  </defs>

                  <circle className="g-base" cx="120" cy="60" r="6" />
                  <circle className="g-ring" cx="120" cy="60" r="26" />

                  {/* 당기는 방향 — 끝점의 돌이 화살촉을 대신합니다 */}
                  <line className="g-pull" x1="120" y1="60" x2="192" y2="96" />
                  <circle className="g-stone" cx="196" cy="98" r="7" />
                  <text className="g-label" x="150" y="112">
                    당기기
                  </text>

                  {/* 날아가는 방향 */}
                  <line
                    className="g-fly"
                    x1="120"
                    y1="60"
                    x2="34"
                    y2="17"
                    markerEnd="url(#guide-arrow)"
                  />
                  <text className="g-label fly" x="30" y="40">
                    날아감
                  </text>
                </svg>
              </div>

              <p className="guide-note">
                조준은 정확히 되지 않습니다. 매번 조금씩 흔들립니다.
              </p>
            </div>
          </li>

          <li>
            <span className="guide-num">3</span>
            <div>
              <b>물이 걷히면 공개됩니다</b>
              <p>
                던지는 동안 지도가 물로 덮이고, 돌이 튈 때마다 한 겹씩 빠집니다. 마지막
                바운스에서 그 자리에 가장 가까운 가게가 나옵니다.
              </p>
              <p className="guide-note">
                반경을 넘겨 던지면 <b>허탕</b>입니다.
              </p>
            </div>
          </li>
        </ol>

        <div className="guide-group">
          <b>같이 정할 때</b>
          <p>
            방을 만들어 코드를 공유하면 모두 같은 기준점·조건으로 던집니다. 각자
            <b> 이걸로 결정</b>을 올리고 <b>붐업 👍 / 붐따 👎</b>로 투표해서 정합니다.
          </p>
        </div>

        <button
          ref={closeRef}
          type="button"
          className="btn primary block"
          onClick={onClose}
        >
          던져보기
        </button>
      </div>
    </div>
  );
}
