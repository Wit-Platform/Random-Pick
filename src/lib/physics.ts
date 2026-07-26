import { PHYSICS, REVEAL } from "./config";
import { destination, screenVectorToBearing, toRadians } from "./geo";
import { gaussian, randInt, uniform, type Rand } from "./prng";
import type { LatLng } from "./types";

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export interface Aim {
  /** 0 = 안 당김, 1 = 최대 */
  power: number;
  /** 북=0, 시계방향 radian */
  bearingRad: number;
}

export interface ThrowPlan {
  /** 노이즈가 섞인 최종 방위각 */
  bearingRad: number;
  /** 플레이어가 의도한 방위각 (조준 콘 렌더에 사용) */
  intendedBearingRad: number;
  totalMeters: number;
  bounces: number;
  /** 각 바운스 지점. 길이 === bounces, 마지막이 최종 착지점 */
  points: LatLng[];
  hopMeters: number[];
}

/**
 * 슬링샷: 기준점에서 포인터까지의 벡터를 "당김"으로 보고 반대 방향으로 발사합니다.
 * dx, dy는 기준점 → 포인터 화면 벡터.
 */
export function pullToAim(dx: number, dy: number): Aim {
  const len = Math.hypot(dx, dy);
  return {
    power: clamp(len / PHYSICS.maxPullPx, 0, 1),
    bearingRad: screenVectorToBearing(-dx, -dy),
  };
}

/** 조준 콘의 반각(radian). 각도 노이즈 2σ를 시각화합니다. */
export function aimConeHalfAngle(): number {
  return toRadians(Math.min(PHYSICS.angleSigmaDeg * 2, PHYSICS.angleClampDeg));
}

/** 노이즈 없는 기대 비행거리 — 조준 콘 길이용 */
export function expectedDistanceM(radiusM: number, power: number): number {
  return radiusM * (PHYSICS.distanceBase + PHYSICS.distanceSpan * clamp(power, 0, 1));
}

/**
 * 던지기 궤적을 미리 전부 계산합니다. rand를 주입받으므로 테스트에서 재현 가능합니다.
 * 애니메이션은 이 결과를 재생만 합니다 — 물리와 렌더를 섞지 않습니다.
 */
export function planThrow(
  base: LatLng,
  radiusM: number,
  aim: Aim,
  rand: Rand,
): ThrowPlan {
  const forceNoise = uniform(rand, PHYSICS.forceNoiseMin, PHYSICS.forceNoiseMax);
  const totalMeters = expectedDistanceM(radiusM, aim.power) * forceNoise;

  const sigma = toRadians(PHYSICS.angleSigmaDeg);
  const limit = toRadians(PHYSICS.angleClampDeg);
  const angleOffset = clamp(gaussian(rand) * sigma, -limit, limit);
  const bearingRad = aim.bearingRad + angleOffset;

  const bounces = randInt(rand, PHYSICS.bounceMin, PHYSICS.bounceMax);

  // 홉 길이는 감쇠하며, 합이 총 비행거리가 되도록 정규화합니다.
  const weights: number[] = [];
  let weightSum = 0;
  for (let i = 0; i < bounces; i++) {
    const w = Math.pow(PHYSICS.damping, i);
    weights.push(w);
    weightSum += w;
  }

  const hopMeters = weights.map((w) => (totalMeters * w) / weightSum);

  const points: LatLng[] = [];
  let cursor = base;
  for (const hop of hopMeters) {
    cursor = destination(cursor, bearingRad, hop);
    points.push(cursor);
  }

  return {
    bearingRad,
    intendedBearingRad: aim.bearingRad,
    totalMeters,
    bounces,
    points,
    hopMeters,
  };
}

export function landingOf(plan: ThrowPlan): LatLng {
  const last = plan.points[plan.points.length - 1];
  if (!last) throw new Error("throw plan has no points");
  return last;
}

/** 착지점 기준 당첨 판정 반경 */
export function revealRadiusM(radiusM: number): number {
  return clamp(radiusM * REVEAL.ratio, REVEAL.minM, REVEAL.maxM);
}

/**
 * index번째 바운스를 마친 직후의 블러 세기.
 * 마지막 바운스(index === total)에서 정확히 0이 됩니다.
 */
export function blurAfterBounce(index: number, total: number): number {
  if (total <= 0) return 0;
  return PHYSICS.blurStartPx * (1 - clamp(index / total, 0, 1));
}

/** 홉 길이에 비례한 지속시간 */
export function hopDurationMs(hopMeters: number, longestHopMeters: number): number {
  if (longestHopMeters <= 0) return PHYSICS.hopMinMs;
  const t = clamp(hopMeters / longestHopMeters, 0, 1);
  return PHYSICS.hopMinMs + (PHYSICS.hopMaxMs - PHYSICS.hopMinMs) * t;
}
