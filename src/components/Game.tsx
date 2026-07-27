"use client";

import { useCallback, useEffect, useReducer, useState } from "react";

import { SNAP_DEFAULT, useBottomSheet } from "@/hooks/useBottomSheet";
import { useGroupFeed } from "@/hooks/useGroupFeed";
import { ALL_CATEGORY_IDS } from "@/lib/categories";
import {
  DEFAULT_BASE,
  GROUP,
  PHYSICS,
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
import Guide from "./Guide";
import GroupPanel from "./GroupPanel";
import MapStage from "./MapStage";
import ResultCard from "./ResultCard";
import SiteFooter from "./SiteFooter";

const NICK_STORAGE_KEY = "lunch:nick";
const GUIDE_STORAGE_KEY = "lunch:guide-seen";

/** 허탕 사유. 사용자가 할 수 있는 조치가 달라서 구분합니다 */
export type MissReason = "overshoot" | "empty" | null;

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
  /** 던져보기 전에는 데이터 출처를 모릅니다 — 미리 조회하지 않기 때문입니다 */
  source: DataSource | null;
  sampleReason?: SampleReason;
  /** 429 등 일시적 안내. 다음 성공 응답에서 사라집니다 */
  notice: string | null;
  /** 허탕 사유 — 너무 멀리 던졌는지, 그 자리가 비었는지 */
  miss: MissReason;
  locating: boolean;
  geoDenied: boolean;
  landing: LatLng | null;
  resolving: boolean;
  /**
   * 착지점에서 가까운 순서로 최대 5곳. 첫 번째가 당첨이고 나머지는 대안입니다.
   * 비어 있으면 허탕입니다.
   */
  revealed: Place[];
  /** 지금 고른 곳. 대안을 누르면 바뀝니다 */
  pickedIndex: number;
  missStreak: number;
  decided: boolean;
  sdkError: string | null;
  fallbackMap: boolean;
  blindNonce: number;

  groupCode: string | null;
  nick: string;
  groupBusy: boolean;
  groupError: string | null;
  /** 방을 만든 브라우저인지 — 잠그기 버튼 노출 판단 */
  groupIsOwner: boolean;
  groupLocked: boolean;
}

type Action =
  | { type: "setBase"; at: LatLng }
  | { type: "geoDone" }
  | { type: "geoFailed" }
  | { type: "setRadius"; m: number }
  | { type: "widenRadius" }
  | { type: "toggleCat"; id: CategoryId }
  | { type: "togglePlaceMode" }
  | { type: "notice"; text: string | null }
  | { type: "throwStart" }
  | { type: "landed"; landing: LatLng }
  | {
      type: "reveal";
      places: Place[];
      source: DataSource | null;
      reason?: SampleReason;
      miss: MissReason;
    }
  | { type: "pick"; index: number }
  | { type: "showResult" }
  | { type: "again" }
  | { type: "decide" }
  | { type: "blindThrow" }
  | { type: "sdkError"; message: string }
  | { type: "fallbackMap" }
  | { type: "setNick"; value: string }
  | { type: "groupBusy"; on: boolean }
  | { type: "groupError"; message: string | null }
  | {
      type: "groupEntered";
      code: string;
      condition: GroupCondition;
      isOwner: boolean;
    }
  | { type: "groupLocked"; locked: boolean }
  | { type: "groupLeft" };

const initialState: State = {
  phase: "idle",
  base: DEFAULT_BASE,
  radiusM: RADIUS.default,
  cats: [...ALL_CATEGORY_IDS],
  placeMode: false,
  source: null,
  notice: null,
  miss: null,
  locating: true,
  geoDenied: false,
  landing: null,
  resolving: false,
  revealed: [],
  pickedIndex: 0,
  missStreak: 0,
  decided: false,
  sdkError: null,
  fallbackMap: false,
  blindNonce: 0,

  groupCode: null,
  nick: "",
  groupBusy: false,
  groupError: null,
  groupIsOwner: false,
  groupLocked: false,
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
        revealed: [],
        pickedIndex: 0,
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
        // 좁은 반경에 500m를 더하면 성격이 완전히 바뀝니다
        radiusM: Math.min(
          RADIUS.max,
          state.radiusM + (state.radiusM < 600 ? 100 : 500),
        ),
        phase: "idle",
        landing: null,
        revealed: [],
        pickedIndex: 0,
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

    case "notice":
      return { ...state, notice: action.text };

    case "throwStart":
      return {
        ...state,
        phase: "flying",
        landing: null,
        revealed: [],
        pickedIndex: 0,
        decided: false,
        resolving: false,
        miss: null,
      };

    case "landed":
      // 블러는 이미 걷혔습니다. 판정 결과를 기다리는 동안 phase는 reveal입니다.
      return { ...state, phase: "reveal", landing: action.landing, resolving: true };

    case "reveal": {
      const hit = action.places.length > 0;
      return {
        ...state,
        resolving: false,
        revealed: action.places,
        pickedIndex: 0,
        miss: action.miss,
        source: action.source ?? state.source,
        sampleReason: action.reason ?? state.sampleReason,
        notice: action.source ? null : state.notice,
        missStreak: hit ? 0 : state.missStreak + 1,
      };
    }

    case "pick":
      // 대안으로 바꿔도 "결정"은 다시 눌러야 합니다
      return { ...state, pickedIndex: action.index, decided: false };

    case "showResult":
      return { ...state, phase: "result" };

    case "again":
      return {
        ...state,
        phase: "idle",
        landing: null,
        revealed: [],
        pickedIndex: 0,
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
        groupIsOwner: action.isOwner,
        groupLocked: Boolean(action.condition.locked),
        base: action.condition.base,
        radiusM: action.condition.radiusM,
        cats: action.condition.cats,
        phase: "idle",
        landing: null,
        revealed: [],
        pickedIndex: 0,
        resolving: false,
        decided: false,
        missStreak: 0,
      };

    case "groupLocked":
      return { ...state, groupLocked: action.locked };

    case "groupLeft":
      return {
        ...state,
        groupCode: null,
        groupError: null,
        groupBusy: false,
        groupIsOwner: false,
        groupLocked: false,
      };

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
  const sheet = useBottomSheet();
  // 처음 방문이면 사용법을 한 번 보여줍니다. 서버 렌더와 어긋나지 않도록
  // 마운트 후에 판단합니다.
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(GUIDE_STORAGE_KEY)) setGuideOpen(true);
    } catch {
      // 저장이 막혀 있으면 매번 보여주지 않고 그냥 넘어갑니다
    }
  }, []);

  const closeGuide = useCallback(() => {
    setGuideOpen(false);
    try {
      window.localStorage.setItem(GUIDE_STORAGE_KEY, "1");
    } catch {
      // 무시
    }
  }, []);

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

  const { base, radiusM, cats } = state;

  /**
   * 착지 후 판정. **던지기 전에는 아무것도 조회하지 않습니다.**
   *
   * 허탕은 **반경을 넘겨 던졌을 때** 납니다. 착지점이 반경 밖이면 조회 없이 바로
   * 허탕이므로 판정이 예측 가능하고("너무 멀리 갔다") 카카오 호출도 아낍니다.
   *
   * 반경 안에 떨어졌으면 **그 자리에서 가장 가까운 곳**이 당첨입니다. 예전에는
   * 당첨자까지 "기준점 반경 안"이어야 해서, 반경 안에 떨어졌는데도 옆 가게가
   * 반경을 살짝 넘으면 허탕이 됐습니다 (실측: 착지점 1008m / 매장 995m).
   */
  const { resolving, landing } = state;
  useEffect(() => {
    if (!resolving || !landing) return;

    // 반경을 넘겨 던졌으면 조회할 필요가 없습니다
    if (distanceM(base, landing) > radiusM) {
      dispatch({ type: "reveal", places: [], source: null, miss: "overshoot" });
      return;
    }
    if (cats.length === 0) {
      dispatch({ type: "reveal", places: [], source: null, miss: "empty" });
      return;
    }

    const abort = new AbortController();
    const params = new URLSearchParams({
      lat: String(landing.lat),
      lng: String(landing.lng),
      radius: String(Math.round(revealRadiusM(radiusM))),
      cats: cats.join(","),
      limit: "5",
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
        return res.ok
          ? ((await res.json()) as {
              places: Place[];
              source: DataSource;
              reason?: SampleReason;
            })
          : null;
      })
      .then((data) => {
        if (abort.signal.aborted) return;
        const places = data?.places ?? [];
        dispatch({
          type: "reveal",
          places,
          source: data?.source ?? null,
          reason: data?.reason,
          miss: places.length > 0 ? null : "empty",
        });
      })
      .catch(() => {
        // 조회 실패는 허탕으로 처리합니다 — 에러로 게임을 막지 않습니다
        if (!abort.signal.aborted) {
          dispatch({ type: "reveal", places: [], source: null, miss: "empty" });
        }
      });

    return () => abort.abort();
  }, [resolving, landing, base, radiusM, cats]);

  /**
   * 시트를 접어두고 던졌으면 결과 카드가 가려집니다. 결과가 뜨는 순간
   * 최소 "보통" 높이까지 올립니다 (이미 더 올려져 있으면 그대로).
   */
  const raiseSheet = sheet.raiseAtLeast;
  useEffect(() => {
    if (state.phase === "result") raiseSheet(SNAP_DEFAULT);
  }, [state.phase, raiseSheet]);

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

  const groupFeed = useGroupFeed(state.groupCode, state.nick);

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
        const res = await fetch(
          `/api/group/${code}?voter=${encodeURIComponent(groupFeed.voterId)}`,
        );
        if (res.status === 403) {
          dispatch({
            type: "groupError",
            message: "이 방은 잠겨 있어 새로 들어갈 수 없습니다.",
          });
          return;
        }
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
          isOwner?: boolean;
        };
        dispatch({
          type: "groupEntered",
          code: data.code,
          condition: data.condition,
          isOwner: Boolean(data.isOwner),
        });
        syncRoomParam(data.code);
      } catch {
        dispatch({ type: "groupError", message: "방에 들어가지 못했습니다." });
      }
    },
    [syncRoomParam, groupFeed.voterId],
  );

  const createRoom = useCallback(async () => {
    dispatch({ type: "groupBusy", on: true });
    try {
      const res = await fetch("/api/group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base, radiusM, cats, voterId: groupFeed.voterId }),
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
        isOwner: true,
      });
      syncRoomParam(data.code);
    } catch {
      dispatch({ type: "groupError", message: "방을 만들지 못했습니다." });
    }
  }, [base, radiusM, cats, syncRoomParam, groupFeed.voterId]);

  const toggleLock = useCallback(
    async (locked: boolean) => {
      const code = state.groupCode;
      if (!code) return;
      dispatch({ type: "groupLocked", locked }); // 먼저 화면을 바꿉니다
      try {
        const res = await fetch(`/api/group/${code}/lock`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ voterId: groupFeed.voterId, locked }),
        });
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        dispatch({ type: "groupLocked", locked: !locked });
        dispatch({ type: "groupError", message: "잠금을 바꾸지 못했습니다." });
      }
    },
    [state.groupCode, groupFeed.voterId],
  );

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

    const { groupCode, nick } = state;
    const winner = state.revealed[state.pickedIndex];
    if (!groupCode || !nick.trim() || !winner) return;
    const distFromBase = distanceM(state.base, winner);

    try {
      const res = await fetch(`/api/group/${groupCode}/throws`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nick,
          placeName: winner.name,
          cat: winner.cat,
          distM: Math.round(distFromBase),
          // 다른 참가자가 카카오맵으로 바로 넘어갈 수 있게
          url: winner.url,
          voterId: groupFeed.voterId,
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
    state.revealed.length === 0;

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
      {guideOpen ? <Guide onClose={closeGuide} /> : null}
      <main className="main">
        <header className="topbar">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand">랜덤픽</span>
          <span className="brand-sub">점심 뭐먹을래?</span>
          <button
            type="button"
            className="help-btn"
            onClick={() => setGuideOpen(true)}
            aria-label="사용법 보기"
            title="사용법"
          >
            ?
          </button>
        </header>

        <div className="stage-wrap">
          <MapStage
            jsKey={jsKey}
            base={state.base}
            radiusM={state.radiusM}
            phase={state.phase}
            placeMode={state.placeMode}
            results={state.revealed}
            pickedIndex={state.pickedIndex}
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
            <p className="stage-hint">
              지도를 옮기거나 확대한 뒤, 원하는 지점을 탭하세요
            </p>
          ) : state.phase === "idle" ? (
            <p className="stage-hint">
              끌면 물이 차오릅니다. 당겼다 놓으면 돌이 날아갑니다
            </p>
          ) : null}
        </div>
      </main>

      <aside className="panel" ref={sheet.panelRef}>
        {/* 손잡이는 실제로 끌립니다. 탭하면 두 높이를 오갑니다 */}
        <button type="button" className="sheet-handle" {...sheet.handleProps}>
          <span className="sheet-grip" aria-hidden="true" />
        </button>

        {state.phase === "result" ? (
          <ResultCard
            results={state.revealed}
            pickedIndex={state.pickedIndex}
            base={state.base}
            landing={state.landing}
            onPick={(index) => dispatch({ type: "pick", index })}
            source={state.source ?? "sample"}
            decided={state.decided}
            missStreak={state.missStreak}
            missReason={state.miss}
            onAgain={() => dispatch({ type: "again" })}
            onDecide={onDecide}
            onWiden={() => dispatch({ type: "widenRadius" })}
            shared={Boolean(state.groupCode)}
          />
        ) : null}

        <ControlSheet
          radiusM={state.radiusM}
          cats={state.cats}
          placeMode={state.placeMode}
          geoDenied={state.geoDenied}
          locating={state.locating}
          phase={state.phase}
          onUseCurrentLocation={locate}
          onTogglePlaceMode={() => dispatch({ type: "togglePlaceMode" })}
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
            members={groupFeed.members}
            isOwner={state.groupIsOwner}
            locked={state.groupLocked}
            onVote={groupFeed.vote}
            onRemove={groupFeed.remove}
            onToggleLock={toggleLock}
            radiusM={state.radiusM}
            cats={state.cats}
            onNick={(value) => dispatch({ type: "setNick", value })}
            onCreate={createRoom}
            onJoin={joinRoom}
            onLeave={leaveRoom}
          />
        ) : null}

        <SiteFooter />
      </aside>
    </div>
  );
}
