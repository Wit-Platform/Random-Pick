import type { LatLng } from "./types";

export const RADIUS = {
  min: 300,
  max: 3000,
  step: 100,
  default: 1000,
} as const;

/**
 * 던지기 밸런스. "방향은 내가 정하되 정확히는 못 맞힌다"가 목표입니다.
 * 노이즈가 작으면 조준 게임이 되고, 크면 그냥 룰렛이 됩니다.
 * 실제로 던져보며 조정할 값들이라 한곳에 모아둡니다.
 */
export const PHYSICS = {
  /** 이 이상 당겨도 힘이 늘지 않음 */
  maxPullPx: 140,
  /** 총 비행거리 = radius * (base + span * power) */
  distanceBase: 0.35,
  distanceSpan: 0.85,
  /** 힘 노이즈 배율 범위 */
  forceNoiseMin: 0.88,
  forceNoiseMax: 1.12,
  /** 각도 노이즈 표준편차 / 클램프 (도) */
  angleSigmaDeg: 10,
  angleClampDeg: 25,
  bounceMin: 3,
  bounceMax: 5,
  /** 홉 길이 감쇠 계수 */
  damping: 0.6,
  hopMinMs: 260,
  hopMaxMs: 480,
  /** 포물선 높이 = 홉 픽셀 길이 * 이 값 */
  arcRatio: 0.35,
  blurStartPx: 16,
  /** 리빌 후 결과 카드가 올라오기까지 */
  revealHoldMs: 620,
} as const;

/**
 * 수면. 물이 블러 대신 가림막 역할을 합니다 — 지도가 물로 덮이고, 바운스마다
 * 물이 빠지면서 지도가 드러납니다.
 *
 * 조준 중에는 완전 불투명이 아니라 살짝 투명하게 둡니다. 후보 점이 어렴풋이
 * 보여야 "어느 쪽으로 던질까"라는 판단이 남기 때문입니다.
 */
export const WATER = {
  aimLevel: 0.66,
  /**
   * 프레임당 수렴 비율. 차오를 때는 빠르게(조준에 즉각 반응), 빠질 때는 천천히
   * (리빌이 사건처럼 느껴지도록) — 같은 값을 쓰면 물이 툭 사라져서 맥이 빠집니다.
   */
  easeRise: 0.19,
  easeFall: 0.07,
  /** 겹쳐 그릴 물결 선의 수 */
  caustics: 6,
  splashLifeMs: 900,
  dropLifeMs: 520,
  /** 돌이 남기는 항적 길이 */
  trailPoints: 26,
  trailLifeMs: 700,
} as const;

/** 착지점 기준 판정 반경 = clamp(R * ratio, min, max) */
export const REVEAL = {
  ratio: 0.3,
  minM: 120,
  maxM: 500,
} as const;

/** 프리뷰로 가져올 후보 상한 (카카오 45건 상한 때문에 어차피 표본입니다) */
export const PREVIEW_LIMIT = 90;

/**
 * IP별 요청 상한. `/api/places`가 인증 없는 공개 프록시라 필요합니다.
 * places는 던지기 1회당 리빌 1건 + 조건 변경 시 프리뷰 1건이라,
 * 정상 플레이는 분당 10건을 넘지 않습니다.
 */
export const RATE_LIMITS = {
  places: { limit: 60, windowSec: 60 },
  groupCreate: { limit: 8, windowSec: 600 },
  groupWrite: { limit: 30, windowSec: 60 },
  groupRead: { limit: 120, windowSec: 60 },
} as const;

/**
 * 카카오 로컬 API 보호 장치.
 *
 * 일일 쿼터의 실제 값은 앱 등급에 따라 다르고 콘솔에서 확인해야 합니다.
 * 그래서 우리 쪽에서 **보수적인 자체 예산**을 두고, 초과하면 실패시키지 않고
 * 샘플 데이터로 내려앉습니다. 하루 종일 API가 죽는 것보다 낫습니다.
 */
export const KAKAO_GUARD = {
  /** KAKAO_DAILY_BUDGET env로 덮어쓸 수 있습니다 */
  defaultDailyBudget: 8_000,
  /** 429를 받으면 이 시간 동안 카카오를 아예 건드리지 않습니다 */
  rateLimitCooldownSec: 600,
  /** 그 외 오류(타임아웃·5xx)에 대한 짧은 서킷 브레이커 */
  errorCooldownSec: 60,
} as const;

/** 던지기 연타 방지 — 서버 상한과 별개로 오조작을 막는 정도 */
export const THROW_COOLDOWN_MS = 650;

/** 그룹 결과 피드 폴링 간격 */
export const FEED_POLL_MS = 5_000;

/**
 * 그룹 설정. 이 상수들은 클라이언트 컴포넌트도 읽으므로 config에 둡니다 —
 * `group.ts`에 두면 store(서버 전용)가 클라이언트 번들로 끌려옵니다.
 */
export const GROUP = {
  ttlSec: 12 * 3600,
  maxNickLength: 12,
  maxFeed: 100,
  codeLength: 6,
} as const;

/** 위치 권한이 거부됐을 때 고를 수 있는 기준점 */
export interface Preset {
  name: string;
  at: LatLng;
}

export const PRESETS: readonly Preset[] = [
  { name: "강남역", at: { lat: 37.4979, lng: 127.0276 } },
  { name: "판교역", at: { lat: 37.3947, lng: 127.1112 } },
  { name: "여의도역", at: { lat: 37.5215, lng: 126.9243 } },
  { name: "홍대입구역", at: { lat: 37.5571, lng: 126.9245 } },
];

export const DEFAULT_BASE: LatLng = PRESETS[0]!.at;
