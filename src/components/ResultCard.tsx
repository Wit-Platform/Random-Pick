"use client";

import { useEffect, useRef } from "react";

import { categoryLabel } from "@/lib/categories";
import { distanceM, formatDistance, walkMinutes } from "@/lib/geo";
import type { DataSource, LatLng, Place } from "@/lib/types";

import type { MissReason } from "./Game";

export interface ResultCardProps {
  /** 착지점에서 가까운 순서. 비어 있으면 허탕 */
  results: Place[];
  /** 메인으로 보여줄 항목. 대안을 누르면 이 자리로 옮겨옵니다 */
  pickedIndex: number;
  base: LatLng;
  landing: LatLng | null;
  source: DataSource;
  decided: boolean;
  missStreak: number;
  /** 허탕 사유 — 조치가 다르므로 문구를 나눕니다 */
  missReason: MissReason;
  /** 그룹에 참가 중인지 — 결정 시 결과가 공개된다는 고지를 띄웁니다 */
  shared: boolean;
  onPick: (index: number) => void;
  onAgain: () => void;
  onDecide: () => void;
  onWiden: () => void;
}

export default function ResultCard(props: ResultCardProps) {
  const { results, pickedIndex, base, landing, source, decided, missStreak } =
    props;
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
  }, [results, pickedIndex]);

  if (results.length === 0) {
    return (
      <div className="result miss" role="status" aria-live="polite">
        <p className="result-name" ref={headingRef} tabIndex={-1}>
          허탕
        </p>
        <p className="hint">
          {props.missReason === "overshoot"
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

  const main = results[pickedIndex] ?? results[0]!;
  const others = results
    .map((place, index) => ({ place, index }))
    .filter((entry) => entry.index !== pickedIndex);

  const mainFromBase = distanceM(base, main);
  const mainFromLanding = landing ? distanceM(landing, main) : 0;

  return (
    <div className="result" role="status" aria-live="polite">
      <p className="result-name" ref={headingRef} tabIndex={-1}>
        {main.name}
      </p>

      <div className="result-meta">
        <span>{main.detail || categoryLabel(main.cat)}</span>
        <span>
          기준점에서 <span className="k">{formatDistance(mainFromBase)}</span>
          {" · 도보 "}
          <span className="k">{walkMinutes(mainFromBase)}분</span>
        </span>
      </div>

      <div className="result-meta">
        <span>
          던진 자리에서{" "}
          <span className="k">{formatDistance(mainFromLanding)}</span>
        </span>
        {main.road ? <span>{main.road}</span> : null}
      </div>

      {main.url && source === "kakao" ? (
        <a
          className="map-link"
          href={main.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          카카오맵에서 보기 →
        </a>
      ) : null}

      {/* 마음에 안 들 때만 열어보는 대안. 접혀 있어야 리빌이 사건으로 남습니다 */}
      {others.length > 0 ? (
        <details className="alts">
          <summary className="alts-toggle">
            <span>맘에 안 들면 여긴 어때요?</span>
            <span className="alts-meta">
              {others.length}곳
              <span className="chev" aria-hidden="true">
                ›
              </span>
            </span>
          </summary>

          <ul className="alt-list">
            {others.map(({ place, index }) => {
              const fromLanding = landing ? distanceM(landing, place) : 0;
              const fromBase = distanceM(base, place);
              return (
                <li key={place.id}>
                  <button
                    type="button"
                    className="alt"
                    onClick={() => props.onPick(index)}
                  >
                    <span className="alt-name">{place.name}</span>
                    <span className="alt-meta">
                      {place.detail || categoryLabel(place.cat)} · 던진 자리에서{" "}
                      <span className="k">{formatDistance(fromLanding)}</span> ·
                      기준점에서{" "}
                      <span className="k">{formatDistance(fromBase)}</span>
                    </span>
                  </button>
                  {place.url && source === "kakao" ? (
                    <a
                      className="pick-link"
                      href={place.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${place.name} 카카오맵에서 보기`}
                    >
                      지도 ↗
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}

      {/* 결정은 그룹에서만 의미가 있습니다 — 혼자 먹으러 갈 때 누를 버튼이 필요하지 않습니다 */}
      {!props.shared ? (
        <div className="row">
          <button type="button" className="btn primary" onClick={props.onAgain}>
            다시 던지기
          </button>
        </div>
      ) : decided ? (
        <>
          <p className="decided">그룹에 올렸습니다. 다른 사람 표를 기다려보세요.</p>
          <div className="row">
            <button type="button" className="btn" onClick={props.onAgain}>
              한 번 더 던지기
            </button>
          </div>
        </>
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
          <p className="hint">
            올리면 그룹원이 <b>붐업 👍 / 붐따 👎</b>로 투표할 수 있습니다. 닉네임과
            식당 이름이 방에 공개됩니다.
          </p>
        </>
      )}
    </div>
  );
}
