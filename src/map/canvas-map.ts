import { makeProjection } from "@/lib/geo";
import { hashInts, mulberry32 } from "@/lib/prng";
import type { LatLng, Point } from "@/lib/types";
import type { MapController, MapPalette, MapView } from "./types";

/**
 * 카카오 JS 키가 없을 때 쓰는 절차적 지도.
 *
 * 좌표를 시드로 도로 격자·블록·공원·물길을 생성하므로 **같은 좌표를 보면 누구나
 * 같은 도시**를 봅니다. 실제 지리는 아니지만, 던지기 감각을 확인하고 게임 루프를
 * 검증하기에는 충분합니다. 키를 넣으면 곧바로 카카오 타일로 교체됩니다.
 */

/** 도로 간격 ≈ 100m */
const ROAD_LAT = 0.0009;
const ROAD_LNG = 0.0011;
/** 이 이상 라인이 많아지면 건물 디테일을 생략합니다 */
const DETAIL_LINE_LIMIT = 70;
const MAX_LINES = 140;
/** 물길이 지나갈 수 있는 위도 간격 */
const WATER_BAND = 0.05;

/** 팔레트가 아직 안 들어왔을 때(최초 fitRadius) 쓰는 값 */
const FALLBACK_PALETTE: MapPalette = {
  paper: "#e7ecea",
  block: "#dce3e0",
  blockAlt: "#d0dad6",
  road: "#f4f7f6",
  roadMajor: "#ffffff",
  park: "#ccdccb",
  water: "#bcd4da",
};

interface Line {
  index: number;
  value: number;
  major: boolean;
}

function buildLines(
  from: number,
  to: number,
  spacing: number,
  axisSalt: number,
): Line[] {
  const first = Math.floor(from / spacing) - 1;
  const last = Math.ceil(to / spacing) + 1;
  const lines: Line[] = [];
  const count = Math.min(last - first, MAX_LINES);

  for (let n = 0; n <= count; n++) {
    const index = first + n;
    const jitter =
      (mulberry32(hashInts(index, axisSalt))() - 0.5) * spacing * 0.28;
    lines.push({
      index,
      value: index * spacing + jitter,
      major: index % 4 === 0,
    });
  }
  return lines;
}

export function createCanvasController(
  canvas: HTMLCanvasElement,
  initialCenter: LatLng,
  initialRadiusM: number,
): MapController {
  let center = initialCenter;
  let metersPerPixel = 1;
  let width = 1;
  let height = 1;
  let palette: MapPalette | null = null;

  const listeners = new Set<() => void>();

  function readSize() {
    width = canvas.clientWidth || 1;
    height = canvas.clientHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return dpr;
  }

  function projection() {
    return makeProjection(center, metersPerPixel, width, height);
  }

  function notify() {
    for (const listener of listeners) listener();
  }

  function drawWater(ctx: CanvasRenderingContext2D, p: ReturnType<typeof projection>, minLat: number, maxLat: number, minLng: number, maxLng: number) {
    if (!palette) return;
    ctx.strokeStyle = palette.water;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(3, 70 / metersPerPixel);

    const kFrom = Math.floor(minLat / WATER_BAND);
    const kTo = Math.ceil(maxLat / WATER_BAND);

    for (let k = kFrom; k <= kTo; k++) {
      // 밴드마다 물길이 있는 건 아닙니다 — 없는 동네도 있어야 자연스럽습니다
      if (mulberry32(hashInts(k, 0x7a17))() < 0.55) continue;

      ctx.beginPath();
      const steps = 28;
      for (let s = 0; s <= steps; s++) {
        const lng = minLng + ((maxLng - minLng) * s) / steps;
        const lat =
          k * WATER_BAND +
          0.006 * Math.sin(lng * 760 + k) +
          0.0028 * Math.sin(lng * 1900);
        const pt = p.project({ lat, lng });
        if (s === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
    }
  }

  function drawBlocks(
    ctx: CanvasRenderingContext2D,
    p: ReturnType<typeof projection>,
    latLines: Line[],
    lngLines: Line[],
    detail: boolean,
  ) {
    if (!palette) return;

    for (let a = 0; a < latLines.length - 1; a++) {
      const low = latLines[a]!;
      const high = latLines[a + 1]!;
      for (let b = 0; b < lngLines.length - 1; b++) {
        const left = lngLines[b]!;
        const right = lngLines[b + 1]!;

        const topLeft = p.project({ lat: high.value, lng: left.value });
        const bottomRight = p.project({ lat: low.value, lng: right.value });
        const x = topLeft.x + 1.5;
        const y = topLeft.y + 1.5;
        const w = bottomRight.x - topLeft.x - 3;
        const h = bottomRight.y - topLeft.y - 3;
        if (w <= 0.5 || h <= 0.5) continue;
        if (x > width || y > height || x + w < 0 || y + h < 0) continue;

        const rand = mulberry32(hashInts(low.index, left.index, 0x9e37));
        const roll = rand();

        if (roll < 0.09) {
          ctx.fillStyle = palette.park;
          ctx.fillRect(x, y, w, h);
          continue;
        }

        ctx.fillStyle = roll < 0.55 ? palette.block : palette.blockAlt;
        ctx.fillRect(x, y, w, h);

        if (!detail || w < 14 || h < 14) continue;

        // 블록 안에 건물 몇 채 — 지도가 비어 보이지 않게 하는 정도로만
        const buildings = 2 + Math.floor(rand() * 3);
        ctx.fillStyle = palette.road;
        ctx.globalAlpha = 0.5;
        for (let i = 0; i < buildings; i++) {
          const bw = w * (0.18 + rand() * 0.3);
          const bh = h * (0.18 + rand() * 0.3);
          const bx = x + rand() * (w - bw);
          const by = y + rand() * (h - bh);
          ctx.fillRect(bx, by, bw, bh);
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawRoads(
    ctx: CanvasRenderingContext2D,
    p: ReturnType<typeof projection>,
    latLines: Line[],
    lngLines: Line[],
    minLng: number,
    maxLng: number,
    minLat: number,
    maxLat: number,
  ) {
    if (!palette) return;

    for (const pass of [false, true]) {
      ctx.strokeStyle = pass ? palette.roadMajor : palette.road;
      ctx.lineWidth = pass ? Math.max(2.5, 26 / metersPerPixel) : Math.max(1, 11 / metersPerPixel);

      ctx.beginPath();
      for (const line of latLines) {
        if (line.major !== pass) continue;
        const from = p.project({ lat: line.value, lng: minLng });
        const to = p.project({ lat: line.value, lng: maxLng });
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
      }
      for (const line of lngLines) {
        if (line.major !== pass) continue;
        const from = p.project({ lat: minLat, lng: line.value });
        const to = p.project({ lat: maxLat, lng: line.value });
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
      }
      ctx.stroke();
    }
  }

  const controller: MapController = {
    kind: "canvas",

    project(ll: LatLng): Point {
      return projection().project(ll);
    },
    unproject(pt: Point): LatLng {
      return projection().unproject(pt);
    },
    getView(): MapView {
      return { center, metersPerPixel, width, height };
    },

    fitRadius(at: LatLng, radiusM: number) {
      center = at;
      readSize();
      const halfMin = Math.max(40, Math.min(width, height) / 2 - 18);
      metersPerPixel = (radiusM * 1.15) / halfMin;
      controller.redraw(palette ?? FALLBACK_PALETTE);
      notify();
    },

    setInteractive() {
      // 폴백 지도는 패닝/줌을 지원하지 않습니다. 조건에 맞춰 자동으로만 맞춥니다.
    },

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    resize() {
      readSize();
      controller.redraw(palette ?? FALLBACK_PALETTE);
      notify();
    },

    redraw(next: MapPalette) {
      palette = next;
      const dpr = readSize();
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = next.paper;
      ctx.fillRect(0, 0, width, height);

      const p = projection();
      const topLeft = p.unproject({ x: 0, y: 0 });
      const bottomRight = p.unproject({ x: width, y: height });
      const minLat = bottomRight.lat;
      const maxLat = topLeft.lat;
      const minLng = topLeft.lng;
      const maxLng = bottomRight.lng;

      const latLines = buildLines(minLat, maxLat, ROAD_LAT, 0x11a3);
      const lngLines = buildLines(minLng, maxLng, ROAD_LNG, 0x22b7);
      const detail =
        latLines.length <= DETAIL_LINE_LIMIT && lngLines.length <= DETAIL_LINE_LIMIT;

      drawBlocks(ctx, p, latLines, lngLines, detail);
      drawWater(ctx, p, minLat, maxLat, minLng, maxLng);
      drawRoads(ctx, p, latLines, lngLines, minLng, maxLng, minLat, maxLat);
    },

    destroy() {
      listeners.clear();
    },
  };

  controller.fitRadius(initialCenter, initialRadiusM);
  return controller;
}
