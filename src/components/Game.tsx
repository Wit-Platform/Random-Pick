"use client";

import { useCallback, useEffect, useReducer } from "react";

import { useGroupFeed } from "@/hooks/useGroupFeed";
import { ALL_CATEGORY_IDS } from "@/lib/categories";
import {
  DEFAULT_BASE,
  GROUP,
  PHYSICS,
  PREVIEW_LIMIT,
  RADIUS,
} from "@/lib/config";
import { distanceM } from "@/lib/geo";
import { landingOf, revealRadiusM, type ThrowPlan } from "@/lib/physics";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/room-code";
import type {
  CategoryId,
  DataSource,
  GroupCondition,
  LatLng,
  Phase,
  Place,
  SampleReason,
} from "@/lib/types";

import ControlSheet from "./ControlSheet";
import GroupPanel from "./GroupPanel";
import MapStage from "./MapStage";
import ResultCard from "./ResultCard";

const NICK_STORAGE_KEY = "lunch:nick";

export interface GameProps {
  jsKey: string;
  /** 카카오 REST 키가 서버에 있는지 — 없으면 처음부터 샘플 데이터입니다 */
  liveData: boolean;
  groupEnabled: boolean;
}

interface State {
  phase: Phase;
  base: LatLng;
  radiusM: number;
  cats: CategoryId[];
  placeMode: boolean;
  candidates: Place[];
  source: DataSource;
  sampleReason?: SampleReason;
  truncated: boolean;
  loading: boolean;
  /** 429 등 일시적 안내. 다음 성공 응답에서 사라집니다 */
  notice: string | null;
  locating: boolean;
  geoDenied: boolean;
  landing: LatLng | null;
  resolving: boolean;
  winner: Place | null;
  distFromBase: number;
  distFromLanding: number;
  missStreak: number;
  decided: boolean;
  sdkError: string | null;
  fallbackMap: boolean;
  blindNonce: number;

  groupCode: string | null;
  nick: string;
  groupBusy: boolean;
  groupError: string | null;
}

type Action =
  | { type: "setBase"; at: LatLng }
  | { type: "geoDone" }
  | { type: "geoFailed" }
  | { type: "setRadius"; m: number }
  | { type: "widenRadius" }
  | { type: "toggleCat"; id: CategoryId }
  | { type: "togglePlaceMode" }
  | { type: "loading"; on: boolean }
  | {
      type: "candidates";
      places: Place[];
      source: DataSource;
      truncated: boolean;
      reason?: SampleReason;
    }
  | { type: "clearCandidates" }
  | { type: "notice"; text: string | null }
  | { type: "throwStart" }
  | { type: "landed"; landing: LatLng }
  | { type: "reveal"; winner: Place | null }
  | { type: "showResult" }
  | { type: "again" }
  | { type: "decide" }
  | { type: "blindThrow" }
  | { type: "sdkError"; message: string }
  | { type: "fallbackMap" }
  | { type: "setNick"; value: string }
  | { type: "groupBusy"; on: boolean }
  | { type: "groupError"; message: string | null }
  | { type: "groupEntered"; code: string; condition: GroupCondition }
  | { type: "groupLeft" };

const initialState: State = {
  phase: "idle",
  base: DEFAULT_BASE,
  radiusM: RADIUS.default,
  cats: [...ALL_CATEGORY_IDS],
  placeMode: false,
  candidates: [],
  source: "sample",
  truncated: false,
  loading: false,
  notice: null,
  locating: true,
  geoDenied: false,
  landing: null,
  resolving: false,
  winner: null,
  distFromBase: 0,
  distFromLanding: 0,
  missStreak: 0,
  decided: false,
  sdkError: null,
  fallbackMap: false,
  blindNonce: 0,

  groupCode: null,
  nick: "",
  groupBusy: false,
  groupError: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "setBase":
      return {
        ...state,
        base: action.at,
        placeMode: false,
        locating: false,
        phase: "idle",
        landing: null,
        winner: null,
        resolving: false,
        decided: false,
        missStreak: 0,
      };

    case "geoDone":
      return { ...state, locating: false };

    case "geoFailed":
      return { ...state, locating: false, geoDenied: true };

    case "setRadius":
      return { ...state, radiusM: action.m };

    case "widenRadius":
      return {
        ...state,
        radiusM: Math.min(RADIUS.max, state.radiusM + 500),
        phase: "idle",
        landing: null,
        winner: null,
        decided: false,
      };

    case "toggleCat": {
      const has = state.cats.includes(action.id);
      return {
        ...state,
        cats: has
          ? state.cats.filter((c) => c !== action.id)
          : [...state.cats, action.id],
      };
    }

    case "togglePlaceMode":
      return { ...state, placeMode: !state.placeMode };

    case "loading":
      return { ...state, loading: action.on };

    case "candidates":
      return {
        ...state,
        candidates: action.places,
        source: action.source,
        sampleReason: action.reason,
        truncated: action.truncated,
        loading: false,
        notice: null,
      };

    case "clearCandidates":
      return { ...state, candidates: [], loading: false, truncated: false };

    case "notice":
      return { ...state, notice: action.text, loading: false };

    case "throwStart":
      return {
        ...state,
        phase: "flying",
        landing: null,
        winner: null,
        decided: false,
        resolving: false,
      };

    case "landed":
      // 블러는 이미 걷혔습니다. 판정 결과를 기다리는 동안 phase는 reveal입니다.
      return { ...state, phase: "reveal", landing: action.landing, resolving: true };

    case "reveal": {
      const landing = state.landing;
      const winner = action.winner;
      return {
        ...state,
        resolving: false,
        winner,
        distFromBase: winner ? distanceM(state.base, winner) : 0,
        distFromLanding: winner && landing ? distanceM(landing, winner) : 0,
        missStreak: winner ? 0 : state.missStreak + 1,
      };
    }

    case "showResult":
      return { ...state, phase: "result" };

    case "again":
      return {
        ...state,
        phase: "idle",
        landing: null,
        winner: null,
        resolving: false,
        decided: false,
      };

    case "decide":
      return { ...state, decided: true };

    case "blindThrow":
      return { ...state, blindNonce: state.blindNonce + 1 };

    case "sdkError":
      return { ...state, sdkError: action.message };

    case "fallbackMap":
      return { ...state, fallbackMap: true };

    case "setNick":
      return { ...state, nick: action.value.slice(0, GROUP.maxNickLength) };

    case "groupBusy":
      return { ...state, groupBusy: action.on, groupError: null };

    case "groupError":
      return { ...state, groupBusy: false, groupError: action.message };

    case "groupEntered":
      // 참가자는 방장이 정한 조건을 그대로 씁니다 — 같은 기준점, 같은 반경, 같은 종류
      return {
        ...state,
        groupCode: action.code,
        groupBusy: false,
        groupError: null,
        base: action.condition.base,
        radiusM: action.condition.radiusM,
        cats: action.condition.cats,
        phase: "idle",
        landing: null,
        winner: null,
        resolving: false,
        decided: false,
        missStreak: 0,
      };

    case "groupLeft":
      return { ...state, groupCode: null, groupError: null, groupBusy: false };

    default:
      return state;
  }
}

/**
 * 왜 샘플로 내려앉았는지를 그대로 알려줍니다. "키가 없다"와 "오늘 예산을 다 썼다"는
 * 사용자가 할 수 있는 조치가 다릅니다.
 */
function sampleBannerText(
  reason: SampleReason | undefined,
  fallbackMap: boolean,
  liveData: boolean,
): string {
  const mapNote = fallbackMap ? "샘플 지도로 그려집니다. " : "";

  switch (reason) {
    case "budget":
      return `${mapNote}오늘 실시간 조회 예산을 다 써서 샘플 식당으로 돌고 있습니다.`;
    case "cooldown":
      return `${mapNote}카카오 API 한도에 걸려 잠시 샘플 식당으로 돌고 있습니다.`;
    case "error":
      return `${mapNote}실시간 식당 데이터를 불러오지 못해 샘플로 대체했습니다.`;
    case "no-key":
      return liveData
        ? `${mapNote}샘플 식당 데이터로 돌고 있습니다.`
        : `${mapNote}REST 키가 없어 샘플 식당 데이터로 돌고 있습니다.`;
    default:
      return `${mapNote}샘플 데이터로 돌고 있습니다. 게임 흐름은 동일합니다.`;
  }
}

export default function Game({ jsKey, liveData, groupEnabled }: GameProps) {
  const [state, dispatch] = useReducer(reducer, initialState);

  /* 현재 위치 — 실패하면 조용히 프리셋 안내로 넘어갑니다 */
  const locate = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      dispatch({ type: "geoFailed" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        dispatch({
          type: "setBase",
          at: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        }),
      () => dispatch({ type: "geoFailed" }),
      { timeout: 8000, maximumAge: 60_000 },
    );
  }, []);

  useEffect(() => {
    locate();
  }, [locate]);

  /* 조건이 바뀌면 후보를 다시 불러옵니다 */
  const { base, radiusM, cats } = state;
  useEffect(() => {
    if (cats.length === 0) {
      dispatch({ type: "clearCandidates" });
      return;
    }

    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      dispatch({ type: "loading", on: true });
      const params = new URLSearchParams({
        lat: String(base.lat),
        lng: String(base.lng),
        radius: String(radiusM),
        cats: cats.join(","),
        limit: String(PREVIEW_LIMIT),
      });

      fetch(`/api/places?${params}`, { signal: abort.signal })
        .then(async (res) => {
          if (res.status === 429) {
            dispatch({
              type: "notice",
              text: "요청이 몰려 잠시 쉬는 중입니다. 곧 다시 시도합니다.",
            });
            return null;
          }
          if (!res.ok) throw new Error(String(res.status));
          return (await res.json()) as {
            places: Place[];
            source: DataSource;
            truncated: boolean;
            reason?: SampleReason;
          };
        })
        .then((data) => {
          if (!data) return;
          dispatch({
            type: "candidates",
            places: data.places,
            source: data.source,
            truncated: data.truncated,
            reason: data.reason,
          });
        })
        .catch(() => {
          if (!abort.signal.aborted) dispatch({ type: "loading", on: false });
        });
    }, 260);

    return () => {
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [base, radiusM, cats]);

  /* 착지 후 판정 — 착지점 반경 내에서, 기준점 반경도 만족하는 최근접 한 곳 */
  const { resolving, landing } = state;
  useEffect(() => {
    if (!resolving || !landing) return;
    const abort = new AbortController();

    const params = new URLSearchParams({
      lat: String(landing.lat),
      lng: String(landing.lng),
      radius: String(Math.round(revealRadiusM(radiusM))),
      cats: cats.join(","),
      limit: "8",
    });

    fetch(`/api/places?${params}`, { signal: abort.signal })
      .then(async (res) => {
        if (res.status === 429) {
          dispatch({
            type: "notice",
            text: "요청이 몰려 판정을 못 했습니다. 잠시 후 다시 던져주세요.",
          });
          return null;
        }
        return res.ok ? ((await res.json()) as { places: Place[] }) : null;
      })
      .then((data) => {
        if (abort.signal.aborted) return;
        const winner =
          data?.places.find((p) => distanceM(base, p) <= radiusM) ?? null;
        dispatch({ type: "reveal", winner });
      })
      .catch(() => {
        // 조회 실패는 허탕으로 처리합니다 — 에러로 게임을 막지 않습니다
        if (!abort.signal.aborted) dispatch({ type: "reveal", winner: null });
      });

    return () => abort.abort();
  }, [resolving, landing, base, radiusM, cats]);

  /* 핀이 꽂히고 잠깐 뒤에 결과 카드를 올립니다 */
  useEffect(() => {
    if (state.phase !== "reveal" || state.resolving) return;
    const timer = window.setTimeout(
      () => dispatch({ type: "showResult" }),
      PHYSICS.revealHoldMs,
    );
    return () => window.clearTimeout(timer);
  }, [state.phase, state.resolving]);

  const onPickBase = useCallback(
    (at: LatLng) => dispatch({ type: "setBase", at }),
    [],
  );
  const onThrowStart = useCallback(() => dispatch({ type: "throwStart" }), []);
  const onLanded = useCallback(
    (plan: ThrowPlan) => dispatch({ type: "landed", landing: landingOf(plan) }),
    [],
  );
  const onSdkError = useCallback(
    (message: string) => dispatch({ type: "sdkError", message }),
    [],
  );
  const onFallbackMap = useCallback(() => dispatch({ type: "fallbackMap" }), []);

  /* ── 그룹 ────────────────────────────────────────────── */

  const groupFeed = useGroupFeed(state.groupCode);

  /** 닉네임만 브라우저에 남깁니다. 좌표나 결과는 저장하지 않습니다. */
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(NICK_STORAGE_KEY);
      if (saved) dispatch({ type: "setNick", value: saved });
    } catch {
      // 프라이빗 모드 등에서 막히면 그냥 매번 입력합니다
    }
  }, []);

  useEffect(() => {
    if (!state.nick) return;
    try {
      window.localStorage.setItem(NICK_STORAGE_KEY, state.nick);
    } catch {
      // 저장 못 해도 동작에는 영향 없습니다
    }
  }, [state.nick]);

  /** 초대 링크가 공유 가능하도록 주소창을 맞춥니다 */
  const syncRoomParam = useCallback((code: string | null) => {
    const url = new URL(window.location.href);
    if (code) url.searchParams.set("room", code);
    else url.searchParams.delete("room");
    window.history.replaceState(null, "", url.toString());
  }, []);

  const joinRoom = useCallback(
    async (code: string) => {
      dispatch({ type: "groupBusy", on: true });
      try {
        const res = await fetch(`/api/group/${code}`);
        if (res.status === 404) {
          dispatch({
            type: "groupError",
            message: "그런 방은 없어요. 코드를 다시 확인해주세요.",
          });
          return;
        }
        if (res.status === 429) {
          dispatch({
            type: "groupError",
            message: "시도가 너무 많습니다. 잠시 후 다시 해주세요.",
          });
          return;
        }
        if (!res.ok) {
          dispatch({ type: "groupError", message: "방에 들어가지 못했습니다." });
          return;
        }
        const data = (await res.json()) as {
          code: string;
          condition: GroupCondition;
        };
        dispatch({
          type: "groupEntered",
          code: data.code,
          condition: data.condition,
        });
        syncRoomParam(data.code);
      } catch {
        dispatch({ type: "groupError", message: "방에 들어가지 못했습니다." });
      }
    },
    [syncRoomParam],
  );

  const createRoom = useCallback(async () => {
    dispatch({ type: "groupBusy", on: true });
    try {
      const res = await fetch("/api/group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base, radiusM, cats }),
      });
      if (res.status === 429) {
        dispatch({
          type: "groupError",
          message: "방을 너무 자주 만들었습니다. 잠시 후 다시 해주세요.",
        });
        return;
      }
      if (!res.ok) {
        dispatch({ type: "groupError", message: "방을 만들지 못했습니다." });
        return;
      }
      const data = (await res.json()) as {
        code: string;
        condition: GroupCondition;
      };
      dispatch({
        type: "groupEntered",
        code: data.code,
        condition: data.condition,
      });
      syncRoomParam(data.code);
    } catch {
      dispatch({ type: "groupError", message: "방을 만들지 못했습니다." });
    }
  }, [base, radiusM, cats, syncRoomParam]);

  const leaveRoom = useCallback(() => {
    dispatch({ type: "groupLeft" });
    syncRoomParam(null);
  }, [syncRoomParam]);

  /** ?room=CODE 로 들어온 경우 자동 참가 */
  useEffect(() => {
    if (!groupEnabled) return;
    const param = new URLSearchParams(window.location.search).get("room");
    if (!param) return;
    const code = normalizeRoomCode(param);
    if (isValidRoomCode(code)) void joinRoom(code);
  }, [groupEnabled, joinRoom]);

  /** "이걸로 결정"만 그룹에 전송합니다. 던질 때마다 보내지 않습니다. */
  const onDecide = useCallback(async () => {
    dispatch({ type: "decide" });

    const { groupCode, nick, winner, distFromBase } = state;
    if (!groupCode || !nick.trim() || !winner) return;

    try {
      const res = await fetch(`/api/group/${groupCode}/throws`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nick,
          placeName: winner.name,
          cat: winner.cat,
          distM: Math.round(distFromBase),
        }),
      });
      if (res.ok) groupFeed.refresh();
    } catch {
      // 전송 실패로 본인의 결정을 되돌리지는 않습니다
    }
  }, [state, groupFeed]);

  const showMiss =
    (state.phase === "reveal" || state.phase === "result") &&
    !state.resolving &&
    !state.winner;

  const banner = state.sdkError
    ? { kind: "error" as const, text: state.sdkError }
    : state.notice
      ? { kind: "warn" as const, text: state.notice }
      : state.source === "sample"
        ? {
            kind: "warn" as const,
            text: sampleBannerText(state.sampleReason, state.fallbackMap, liveData),
          }
        : null;

  return (
    <div className="app">
      <main className="main">
        <header className="topbar">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand">랜덤픽</span>
          <span className="brand-sub">점심 뭐먹을래?</span>
        </header>

        <div className="stage-wrap">
          <MapStage
            jsKey={jsKey}
            base={state.base}
            radiusM={state.radiusM}
            candidates={state.candidates}
            phase={state.phase}
            placeMode={state.placeMode}
            winner={state.winner}
            landing={state.landing}
            blindThrowNonce={state.blindNonce}
            onPickBase={onPickBase}
            onThrowStart={onThrowStart}
            onLanded={onLanded}
            onSdkError={onSdkError}
            onFallbackMap={onFallbackMap}
          />

          {banner ? (
            <div className={`banner ${banner.kind}`} role="status">
              <span>{banner.text}</span>
            </div>
          ) : null}

          {showMiss ? (
            <div className="stamp" aria-hidden="true">
              <span>허탕</span>
            </div>
          ) : null}

          {state.placeMode ? (
            <p className="stage-hint">지도를 탭해서 기준점을 정하세요</p>
          ) : state.phase === "idle" ? (
            <p className="stage-hint">
              끌면 물이 차오릅니다. 당겼다 놓으면 돌이 날아갑니다
            </p>
          ) : null}
        </div>
      </main>

      <aside className="panel">
        {state.phase === "result" ? (
          <ResultCard
            winner={state.winner}
            distFromBase={state.distFromBase}
            distFromLanding={state.distFromLanding}
            source={state.source}
            decided={state.decided}
            missStreak={state.missStreak}
            onAgain={() => dispatch({ type: "again" })}
            onDecide={onDecide}
            onWiden={() => dispatch({ type: "widenRadius" })}
            shared={Boolean(state.groupCode)}
          />
        ) : null}

        <ControlSheet
          radiusM={state.radiusM}
          cats={state.cats}
          candidateCount={state.candidates.length}
          loading={state.loading}
          placeMode={state.placeMode}
          geoDenied={state.geoDenied}
          locating={state.locating}
          phase={state.phase}
          onUseCurrentLocation={locate}
          onTogglePlaceMode={() => dispatch({ type: "togglePlaceMode" })}
          onPreset={(at) => dispatch({ type: "setBase", at })}
          onRadius={(m) => dispatch({ type: "setRadius", m })}
          onToggleCat={(id) => dispatch({ type: "toggleCat", id })}
          onBlindThrow={() => dispatch({ type: "blindThrow" })}
        />

        {groupEnabled ? (
          <GroupPanel
            code={state.groupCode}
            nick={state.nick}
            busy={state.groupBusy}
            error={state.groupError}
            expired={groupFeed.expired}
            feed={groupFeed.throws}
            radiusM={state.radiusM}
            cats={state.cats}
            onNick={(value) => dispatch({ type: "setNick", value })}
            onCreate={createRoom}
            onJoin={joinRoom}
            onLeave={leaveRoom}
          />
        ) : null}

        <p className="footnote">
          {state.truncated
            ? "지도의 점은 이 동네 표본입니다 (카카오 검색당 45건 상한). 당첨은 돌이 떨어진 자리에서 다시 조회해 정확히 판정합니다."
            : "지도의 점은 반경 안 후보입니다."}
        </p>
      </aside>
    </div>
  );
}
