import type { LatLng, Point } from "@/lib/types";

export interface MapView {
  center: LatLng;
  metersPerPixel: number;
  width: number;
  height: number;
}

/** 지도 폴백이 쓸 색. CSS 토큰에서 읽어 넘깁니다. */
export interface MapPalette {
  paper: string;
  block: string;
  blockAlt: string;
  road: string;
  roadMajor: string;
  park: string;
  water: string;
}

/**
 * 카카오 지도와 폴백 캔버스 지도가 공유하는 최소 인터페이스.
 * 게임 오버레이는 이 인터페이스만 알고 있으면 되므로, 지도 구현을 바꿔도
 * 던지기 로직은 손대지 않습니다.
 */
export interface MapController {
  readonly kind: "kakao" | "canvas";
  project(ll: LatLng): Point;
  unproject(p: Point): LatLng;
  getView(): MapView;
  /** 중심과 반경이 화면에 들어오도록 맞춥니다 */
  fitRadius(center: LatLng, radiusM: number): void;
  /** 비행 중에는 지도 조작을 잠급니다 */
  setInteractive(on: boolean): void;
  /** 뷰가 바뀔 때 호출됩니다. 해제 함수를 반환합니다 */
  subscribe(listener: () => void): () => void;
  /** 컨테이너 크기 변경 반영 */
  resize(): void;
  /** 폴백 지도만 실제로 그립니다. 카카오는 no-op */
  redraw(palette: MapPalette): void;
  destroy(): void;
}
