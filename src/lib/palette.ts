import type { MapPalette } from "@/map/types";

/** 게임 오버레이가 캔버스에 직접 그릴 때 쓰는 색 */
export interface OverlayPalette {
  water: string;
  flare: string;
  gold: string;
  ink: string;
  stone: string;
  stoneRing: string;
  surface: string;
}

function reader(el: HTMLElement) {
  const cs = getComputedStyle(el);
  return (name: string, fallback: string): string =>
    cs.getPropertyValue(name).trim() || fallback;
}

export function readMapPalette(el: HTMLElement): MapPalette {
  const v = reader(el);
  return {
    paper: v("--map-paper", "#e7ecea"),
    block: v("--map-block", "#dce3e0"),
    blockAlt: v("--map-block-alt", "#d0dad6"),
    road: v("--map-road", "#f4f7f6"),
    roadMajor: v("--map-road-major", "#ffffff"),
    park: v("--map-park", "#ccdccb"),
    water: v("--map-water", "#bcd4da"),
  };
}

export function readOverlayPalette(el: HTMLElement): OverlayPalette {
  const v = reader(el);
  return {
    water: v("--water", "#0d5852"),
    flare: v("--flare", "#bb4325"),
    gold: v("--gold", "#8e6712"),
    ink: v("--ink", "#0e1a18"),
    stone: v("--stone", "#263733"),
    stoneRing: v("--stone-ring", "rgba(14,26,24,0.28)"),
    surface: v("--surface", "#f7f9f8"),
  };
}

export function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
