import { makeProjection, metersPerDegLng } from "@/lib/geo";
import type { LatLng, Point } from "@/lib/types";
import type { MapController, MapView } from "./types";

/**
 * 카카오맵 SDK 어댑터.
 *
 * 좌표 변환은 SDK의 Projection API에 의존하지 않고 `getBounds()` + 컨테이너
 * 크기에서 픽셀당 미터를 직접 계산합니다. 수 km 범위에서는 선형 근사로 충분하고,
 * SDK 내부 API 변경에 영향받지 않습니다.
 */

interface KakaoLatLng {
  getLat(): number;
  getLng(): number;
}

interface KakaoBounds {
  getSouthWest(): KakaoLatLng;
  getNorthEast(): KakaoLatLng;
}

interface KakaoMouseEvent {
  latLng?: KakaoLatLng;
}

interface KakaoMap {
  getCenter(): KakaoLatLng;
  setCenter(ll: KakaoLatLng): void;
  getBounds(): KakaoBounds;
  getLevel(): number;
  setLevel(level: number): void;
  setDraggable(on: boolean): void;
  setZoomable(on: boolean): void;
  relayout(): void;
}

interface KakaoMapsNamespace {
  Map: new (
    container: HTMLElement,
    options: { center: KakaoLatLng; level: number },
  ) => KakaoMap;
  LatLng: new (lat: number, lng: number) => KakaoLatLng;
  event: {
    addListener(
      target: unknown,
      type: string,
      handler: (event?: KakaoMouseEvent) => void,
    ): void;
    removeListener(
      target: unknown,
      type: string,
      handler: (event?: KakaoMouseEvent) => void,
    ): void;
  };
  load(callback: () => void): void;
}

declare global {
  interface Window {
    kakao?: { maps?: KakaoMapsNamespace };
  }
}

const SDK_ID = "kakao-maps-sdk";
let sdkPromise: Promise<KakaoMapsNamespace> | null = null;

export class KakaoSdkError extends Error {}

/**
 * SDK를 한 번만 로드합니다. 실패는 대부분 [플랫폼 > Web > 사이트 도메인] 미등록이라
 * 조용히 넘기지 않고 명시적으로 알립니다.
 */
export function loadKakaoSdk(jsKey: string): Promise<KakaoMapsNamespace> {
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<KakaoMapsNamespace>((resolve, reject) => {
    const ready = () => {
      const maps = window.kakao?.maps;
      if (!maps) {
        reject(new KakaoSdkError("카카오맵 SDK를 초기화하지 못했습니다"));
        return;
      }
      maps.load(() => resolve(maps));
    };

    const existing = document.getElementById(SDK_ID);
    if (existing) {
      if (window.kakao?.maps) ready();
      else existing.addEventListener("load", ready, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = SDK_ID;
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(jsKey)}&autoload=false`;
    script.addEventListener("load", ready, { once: true });
    script.addEventListener("error", () => {
      sdkPromise = null;
      reject(
        new KakaoSdkError(
          "카카오맵 SDK를 불러오지 못했습니다. 카카오 개발자 콘솔에서 [플랫폼 > Web > 사이트 도메인]에 현재 주소를 등록했는지 확인해주세요.",
        ),
      );
    });
    document.head.appendChild(script);
  });

  return sdkPromise;
}

const VIEW_EVENTS = ["bounds_changed", "zoom_changed", "center_changed"] as const;

export function createKakaoController(
  maps: KakaoMapsNamespace,
  container: HTMLElement,
  center: LatLng,
  radiusM: number,
): MapController {
  const map = new maps.Map(container, {
    center: new maps.LatLng(center.lat, center.lng),
    level: 5,
  });

  const listeners = new Set<() => void>();
  let view = computeView();

  function computeView(): MapView {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    const c = map.getCenter();
    const centerNow: LatLng = { lat: c.getLat(), lng: c.getLng() };

    const bounds = map.getBounds();
    const lngSpan = bounds.getNorthEast().getLng() - bounds.getSouthWest().getLng();
    const metersPerPixel =
      lngSpan > 0
        ? (lngSpan * metersPerDegLng(centerNow.lat)) / width
        : 1;

    return { center: centerNow, metersPerPixel, width, height };
  }

  function refresh() {
    view = computeView();
    for (const listener of listeners) listener();
  }

  const onViewEvent = () => refresh();
  for (const type of VIEW_EVENTS) {
    maps.event.addListener(map, type, onViewEvent);
  }

  function projection() {
    return makeProjection(
      view.center,
      view.metersPerPixel,
      view.width,
      view.height,
    );
  }

  const controller: MapController = {
    kind: "kakao",
    project(ll: LatLng): Point {
      return projection().project(ll);
    },
    unproject(p: Point): LatLng {
      return projection().unproject(p);
    },
    getView() {
      return view;
    },
    /**
     * 반경이 화면에 알맞게 차도록 줌 레벨을 맞춥니다.
     *
     * `setBounds`는 bounds를 포함하는 이산 레벨을 고르기 때문에 필요보다 훨씬 축소되는
     * 일이 잦습니다. 대신 현재 픽셀당 미터를 측정해서 목표까지 몇 레벨 움직여야 하는지
     * 직접 계산합니다 — 카카오 레벨은 한 단계마다 해상도가 2배씩 변하므로 log2입니다.
     * 레벨↔해상도 표를 하드코딩하지 않아 SDK가 바뀌어도 스스로 보정됩니다.
     */
    fitRadius(at: LatLng, radius: number) {
      map.setCenter(new maps.LatLng(at.lat, at.lng));
      refresh();

      const shortSide = Math.max(80, Math.min(view.width, view.height));
      // 반경 원이 짧은 변의 약 80%를 차지하도록
      const desired = (radius * 2 * 1.25) / shortSide;

      for (let attempt = 0; attempt < 5; attempt++) {
        const current = view.metersPerPixel;
        if (!(current > 0)) break;

        const steps = Math.round(Math.log2(desired / current));
        if (steps === 0) break;

        const level = map.getLevel();
        const next = Math.min(14, Math.max(1, level + steps));
        if (next === level) break;

        map.setLevel(next);
        refresh();
      }
    },
    setInteractive(on: boolean) {
      map.setDraggable(on);
      map.setZoomable(on);
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onClick(listener: (at: LatLng) => void) {
      const handler = (event?: KakaoMouseEvent) => {
        const ll = event?.latLng;
        if (ll) listener({ lat: ll.getLat(), lng: ll.getLng() });
      };
      maps.event.addListener(map, "click", handler);
      return () => maps.event.removeListener(map, "click", handler);
    },
    resize() {
      map.relayout();
      refresh();
    },
    redraw() {
      // 카카오가 타일을 직접 그리므로 할 일이 없습니다
    },
    destroy() {
      for (const type of VIEW_EVENTS) {
        maps.event.removeListener(map, type, onViewEvent);
      }
      listeners.clear();
    },
  };

  controller.fitRadius(center, radiusM);
  return controller;
}
