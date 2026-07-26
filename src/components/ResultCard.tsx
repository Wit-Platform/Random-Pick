"use client";

import { useEffect, useRef } from "react";

import { categoryLabel } from "@/lib/categories";
import { formatDistance, walkMinutes } from "@/lib/geo";
import type { DataSource, Place } from "@/lib/types";

import type { MissReason } from "./Game";

export interface ResultCardProps {
  winner: Place | null;
  distFromBase: number;
  distFromLanding: number;
  source: DataSource;
  decided: boolean;
  missStreak: number;
  /** 허탕 사유 — 조치가 다르므로 문구를 나눕니다 */
  missReason: MissReason;
  /** 그룹에 참가 중인지 — 결정 시 결과가 공개된다는 고지를 띄웁니다 */
  shared: boolean;
  onAgain: () => void;
  onDecide: () => void;
  onWiden: () => void;
}

export default function ResultCard(props: ResultCardProps) {
  const { winner, source, decided, missStreak, missReason, shared } = props;
  const headingRef = useRef<HTMLParagraphElement | null>(null);

  /**
   * 결과가 나오면 스크린리더가 읽고 키보드 포커스가 여기로 옵니다.
   *
   * 카드는 스크롤되는 패널의 **맨 위**에 삽입되므로, 사용자가 아래쪽(종류·그룹)을
   * 보고 있었다면 카드가 시야 밖에 생깁니다. 결과가 안 뜬 것처럼 보이므로
   * 명시적으로 스크롤해서 올립니다.
   */
  useEffect(() => {
    const el = headingRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest" });
  }, [winner]);

  if (!winner) {
    return (
      <div className="result miss" role="status" aria-live="polite">
        <p className="result-name" ref={headingRef} tabIndex={-1}>
          허탕
        </p>
        <p className="hint">
          {missReason === "overshoot"
            ? "너무 멀리 던졌습니다. 돌이 반경을 넘어갔습니다."
            : "돌이 떨어진 자리 근처에 조건에 맞는 곳이 없었습니다."}
        </p>
        <div className="row">
          <button type="button" className="btn primary" onClick={props.onAgain}>
            다시 던지기
          </button>
          {missStreak >= 2 ? (
            <button type="button" className="btn" onClick={props.onWiden}>
              반경 넓히기
            </button>
          ) : null}
        </div>
        {missStreak >= 2 ? (
          <p className="hint warn">
            {missStreak}번 연속 허탕입니다. 반경을 넓히거나 종류를 더 고르면
            확률이 올라갑니다.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="result" role="status" aria-live="polite">
      <p className="result-name" ref={headingRef} tabIndex={-1}>
        {winner.name}
      </p>

      <div className="result-meta">
        <span>{winner.detail || categoryLabel(winner.cat)}</span>
        <span>
          기준점에서 <span className="k">{formatDistance(props.distFromBase)}</span>
          {" · 도보 "}
          <span className="k">{walkMinutes(props.distFromBase)}분</span>
        </span>
      </div>

      <div className="result-meta">
        <span>
          던진 자리에서{" "}
          <span className="k">{formatDistance(props.distFromLanding)}</span>
        </span>
        {winner.road ? <span>{winner.road}</span> : null}
      </div>

      {winner.url && source === "kakao" ? (
        <a
          className="map-link"
          href={winner.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          카카오맵에서 보기 →
        </a>
      ) : null}

      {decided ? (
        <p className="decided">
          결정했습니다. 잘 먹고 오세요.
          {shared ? " 그룹에 공유했습니다." : null}
        </p>
      ) : (
        <>
          <div className="row">
            <button
              type="button"
              className="btn primary"
              onClick={props.onDecide}
            >
              이걸로 결정
            </button>
            <button type="button" className="btn" onClick={props.onAgain}>
              다시 던지기
            </button>
          </div>
          {shared ? (
            <p className="hint">
              결정하면 닉네임과 식당 이름이 그룹원 전원에게 공개됩니다.
            </p>
          ) : null}
        </>
      )}
      {decided ? (
        <div className="row">
          <button type="button" className="btn" onClick={props.onAgain}>
            한 번 더 던지기
          </button>
        </div>
      ) : null}
    </div>
  );
}
