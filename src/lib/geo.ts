import type { LatLng, Point } from "./types";

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/**
 * 평균 지구 반지름. `distanceM`(하버사인)과 `destination`(평면 근사)이 **같은
 * 반지름을 쓰는 것이 중요합니다.** 흔히 쓰는 111320(적도 반지름 기준)을 섞어 쓰면
 * 두 함수가 0.11%씩 어긋나서, 던진 거리와 표시되는 거리가 미묘하게 안 맞습니다.
 */
export const EARTH_RADIUS_M = 6_371_008.8;

export const M_PER_DEG_LAT = EARTH_RADIUS_M * D2R;

/** 해당 위도에서 경도 1도가 몇 미터인지 */
export function metersPerDegLng(lat: number): number {
  return M_PER_DEG_LAT * Math.cos(lat * D2R);
}

/** 하버사인 거리 (m) */
export function distanceM(a: LatLng, b: LatLng): number {
  const R = EARTH_RADIUS_M;
  const dLat = (b.lat - a.lat) * D2R;
  const dLng = (b.lng - a.lng) * D2R;
  const sLat = Math.sin(dLat / 2);
  const sLng = Math.sin(dLng / 2);
  const h =
    sLat * sLat + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * sLng * sLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 시작점에서 방위각(북=0, 시계방향, radian)으로 distanceM 미터 이동한 지점.
 * 수 km 범위에서만 쓰므로 평면 근사로 충분합니다.
 */
export function destination(
  from: LatLng,
  bearingRad: number,
  meters: number,
): LatLng {
  const north = Math.cos(bearingRad) * meters;
  const east = Math.sin(bearingRad) * meters;
  return {
    lat: from.lat + north / M_PER_DEG_LAT,
    lng: from.lng + east / metersPerDegLng(from.lat),
  };
}

/** 화면 벡터(오른쪽 +x, 아래 +y) → 방위각 radian */
export function screenVectorToBearing(dx: number, dy: number): number {
  return Math.atan2(dx, -dy);
}

export function toDegrees(rad: number): number {
  return rad * R2D;
}

export function toRadians(deg: number): number {
  return deg * D2R;
}

/** 사람이 읽는 거리 표기 */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)}km`;
}

/** 걸어서 몇 분 — 도보 4.5km/h 가정 */
export function walkMinutes(meters: number): number {
  return Math.max(1, Math.round(meters / 75));
}

/**
 * 중심과 픽셀당 미터를 아는 선형 투영. 카카오 지도와 폴백 캔버스 지도가
 * 같은 좌표 변환을 공유하도록 여기 한 곳에만 둡니다.
 */
export function makeProjection(
  center: LatLng,
  metersPerPixel: number,
  width: number,
  height: number,
) {
  const mPerLng = metersPerDegLng(center.lat);
  const cx = width / 2;
  const cy = height / 2;

  return {
    project(ll: LatLng): Point {
      return {
        x: cx + ((ll.lng - center.lng) * mPerLng) / metersPerPixel,
        y: cy - ((ll.lat - center.lat) * M_PER_DEG_LAT) / metersPerPixel,
      };
    },
    unproject(p: Point): LatLng {
      return {
        lat: center.lat + ((cy - p.y) * metersPerPixel) / M_PER_DEG_LAT,
        lng: center.lng + ((p.x - cx) * metersPerPixel) / mPerLng,
      };
    },
  };
}
