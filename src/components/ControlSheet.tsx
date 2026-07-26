"use client";

import { CATEGORIES } from "@/lib/categories";
import { PRESETS, RADIUS } from "@/lib/config";
import { formatDistance, walkMinutes } from "@/lib/geo";
import { prefersDark } from "@/lib/palette";
import type { CategoryId, LatLng, Phase } from "@/lib/types";

export interface ControlSheetProps {
  radiusM: number;
  cats: CategoryId[];
  candidateCount: number;
  loading: boolean;
  placeMode: boolean;
  geoDenied: boolean;
  locating: boolean;
  phase: Phase;
  onUseCurrentLocation: () => void;
  onTogglePlaceMode: () => void;
  onPreset: (at: LatLng) => void;
  onRadius: (m: number) => void;
  onToggleCat: (id: CategoryId) => void;
  onBlindThrow: () => void;
}

export default function ControlSheet(props: ControlSheetProps) {
  const {
    radiusM,
    cats,
    candidateCount,
    loading,
    placeMode,
    geoDenied,
    locating,
    phase,
  } = props;

  const dark = typeof window !== "undefined" ? prefersDark() : false;
  const noCats = cats.length === 0;
  const idle = phase === "idle";

  return (
    <>
      <div className="group">
        <div className="group-head">
          <span className="label">기준점</span>
          {locating ? <span className="value">확인 중…</span> : null}
        </div>
        <div className="row">
          <button
            type="button"
            className="btn"
            onClick={props.onUseCurrentLocation}
            disabled={!idle}
          >
            현재 위치
          </button>
          <button
            type="button"
            className={`btn${placeMode ? " on" : ""}`}
            onClick={props.onTogglePlaceMode}
            disabled={!idle}
            aria-pressed={placeMode}
          >
            {placeMode ? "지도를 탭하세요" : "지도에서 찍기"}
          </button>
        </div>
        <div className="row">
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              className="btn"
              onClick={() => props.onPreset(preset.at)}
              disabled={!idle}
            >
              {preset.name}
            </button>
          ))}
        </div>
        {geoDenied ? (
          <p className="hint">
            위치를 가져오지 못했습니다. 위 버튼으로 고르거나 지도를 직접 탭해서
            기준점을 정해주세요.
          </p>
        ) : null}
      </div>

      <div className="group">
        <div className="group-head">
          <span className="label">반경</span>
          <span className="value">
            {formatDistance(radiusM)} · 도보 {walkMinutes(radiusM)}분
          </span>
        </div>
        <input
          type="range"
          min={RADIUS.min}
          max={RADIUS.max}
          step={RADIUS.step}
          value={radiusM}
          disabled={!idle}
          onChange={(e) => props.onRadius(Number(e.target.value))}
          aria-label="반경"
        />
      </div>

      <div className="group">
        <div className="group-head">
          <span className="label">음식 종류</span>
          <span className="value">
            {loading ? "…" : `후보 ${candidateCount}곳`}
          </span>
        </div>
        <div className="row">
          {CATEGORIES.map((cat) => {
            const on = cats.includes(cat.id);
            return (
              <button
                key={cat.id}
                type="button"
                className={`btn cat${on ? " on" : ""}`}
                onClick={() => props.onToggleCat(cat.id)}
                disabled={!idle}
                aria-pressed={on}
              >
                <span
                  className="cat-dot"
                  style={{ background: dark ? cat.dotDark : cat.dot }}
                  aria-hidden="true"
                />
                {cat.label}
              </button>
            );
          })}
        </div>
        {noCats ? (
          <p className="hint warn">한 종류는 골라주세요.</p>
        ) : !loading && candidateCount === 0 ? (
          <p className="hint warn">
            반경 안에 조건에 맞는 곳이 없습니다. 반경을 넓히거나 종류를 더
            골라주세요.
          </p>
        ) : null}
      </div>

      <div className="group">
        <div className="group-head">
          <span className="label">던지기</span>
        </div>
        <p className="hint">
          기준점에서 <b>당겼다 놓으면</b> 돌이 날아갑니다. 당긴 반대 방향으로
          가고, 조준은 뜻대로 되지 않습니다.
        </p>
        <button
          type="button"
          className="btn block"
          onClick={props.onBlindThrow}
          disabled={!idle || noCats}
        >
          그냥 던지기
        </button>
      </div>
    </>
  );
}
