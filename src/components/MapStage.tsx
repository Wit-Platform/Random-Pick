"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CATEGORIES } from "@/lib/categories";
import { DEFAULT_BASE, PHYSICS, THROW_COOLDOWN_MS } from "@/lib/config";
import {
  prefersDark,
  prefersReducedMotion,
  readMapPalette,
  readOverlayPalette,
  type OverlayPalette,
} from "@/lib/palette";
import {
  aimConeHalfAngle,
  blurAfterBounce,
  expectedDistanceM,
  hopDurationMs,
  planThrow,
  pullToAim,
  revealRadiusM,
  type ThrowPlan,
} from "@/lib/physics";
import type { CategoryId, LatLng, Phase, Place, Point } from "@/lib/types";
import { createCanvasController } from "@/map/canvas-map";
import { createKakaoController, loadKakaoSdk } from "@/map/kakao";
import type { MapController } from "@/map/types";

export interface MapStageProps {
  jsKey: string;
  base: LatLng | null;
  radiusM: number;
  candidates: Place[];
  phase: Phase;
  placeMode: boolean;
  winner: Place | null;
  landing: LatLng | null;
  /** 값이 바뀌면 방향 무작위로 한 번 던집니다 (키보드·접근성 대체 수단) */
  blindThrowNonce: number;
  onPickBase: (at: LatLng) => void;
  onThrowStart: () => void;
  onLanded: (plan: ThrowPlan) => void;
  onSdkError: (message: string) => void;
  onFallbackMap: () => void;
}

interface Flight {
  plan: ThrowPlan;
  durations: number[];
  hopIndex: number;
  hopStart: number;
  hopEnd: number;
}

interface Ripple {
  at: LatLng;
  t0: number;
}

const RIPPLE_LIFE_MS = 740;
const DOT_RADIUS = 3.2;

function dotColor(cat: CategoryId, dark: boolean): string {
  const meta = CATEGORIES.find((c) => c.id === cat);
  if (!meta) return dark ? "#8CA09B" : "#77857F";
  return dark ? meta.dotDark : meta.dot;
}

/** 방위각(북=0, 시계방향) → 캔버스 각도(x축 기준, y는 아래로 증가) */
function bearingToCanvasAngle(bearingRad: number): number {
  return Math.atan2(-Math.cos(bearingRad), Math.sin(bearingRad));
}

export default function MapStage(props: MapStageProps) {
  const { jsKey } = props;

  const stageRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const kakaoHostRef = useRef<HTMLDivElement | null>(null);
  const fallbackRef = useRef<HTMLCanvasElement | null>(null);
  const dotsRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);

  const controllerRef = useRef<MapController | null>(null);
  const paletteRef = useRef<OverlayPalette | null>(null);
  const darkRef = useRef(false);

  const aimRef = useRef<{ active: boolean; x: number; y: number }>({
    active: false,
    x: 0,
    y: 0,
  });
  const flightRef = useRef<Flight | null>(null);
  const ripplesRef = useRef<Ripple[]>([]);
  const pinShownAtRef = useRef(0);
  /** 연타 방지. 던지기 1회 = 리빌 조회 1회라 서버 쿼터와 직결됩니다 */
  const lastThrowRef = useRef(0);

  // 애니메이션 루프가 최신 props를 보되, 조준 중 리렌더는 일으키지 않도록 ref로 넘깁니다
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });

  const [ready, setReady] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);

  /* ── 캔버스 크기 맞추기 ─────────────────────────────── */

  const sizeCanvas = useCallback((canvas: HTMLCanvasElement): number => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round((canvas.clientWidth || 1) * dpr);
    const h = Math.round((canvas.clientHeight || 1) * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return dpr;
  }, []);

  /* ── 후보 점 (블러 레이어 안쪽에 그려서 비행 중 가려집니다) ── */

  const drawDots = useCallback(() => {
    const canvas = dotsRef.current;
    const controller = controllerRef.current;
    if (!canvas || !controller) return;

    const dpr = sizeCanvas(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const dark = darkRef.current;
    for (const place of propsRef.current.candidates) {
      const pt = controller.project(place);
      if (pt.x < -8 || pt.y < -8 || pt.x > w + 8 || pt.y > h + 8) continue;
      ctx.globalAlpha = 0.82;
      ctx.fillStyle = dotColor(place.cat, dark);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, [sizeCanvas]);

  /** 폴백 지도 + 후보 점을 다시 그립니다 (뷰·테마 변경 시) */
  const renderStatic = useCallback(() => {
    const stage = stageRef.current;
    const controller = controllerRef.current;
    if (!stage || !controller) return;
    darkRef.current = prefersDark();
    paletteRef.current = readOverlayPalette(stage);
    controller.redraw(readMapPalette(stage));
    drawDots();
  }, [drawDots]);

  /* ── 블러 제어 ────────────────────────────────────── */

  const setBlur = useCallback((px: number, ms: number) => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.style.transitionDuration = `${ms}ms`;
    layer.style.filter = `blur(${px.toFixed(2)}px)`;
    // 블러 시 가장자리에 배경이 비치는 것을 살짝 확대해 가립니다.
    // 마지막에 scale(1)로 돌아오면서 "가라앉는" 느낌이 납니다.
    layer.style.transform = px > 0.05 ? "scale(1.05)" : "scale(1)";
  }, []);

  /* ── 지도 초기화 ──────────────────────────────────── */

  useEffect(() => {
    let cancelled = false;
    const host = kakaoHostRef.current;
    const fallback = fallbackRef.current;
    if (!host || !fallback) return;

    const start = propsRef.current.base ?? DEFAULT_BASE;
    const radius = propsRef.current.radiusM;

    async function init() {
      if (jsKey) {
        try {
          const maps = await loadKakaoSdk(jsKey);
          if (cancelled) return;
          controllerRef.current = createKakaoController(maps, host!, start, radius);
          setUsingFallback(false);
          setReady(true);
          return;
        } catch (err) {
          if (cancelled) return;
          propsRef.current.onSdkError(
            err instanceof Error ? err.message : "카카오맵을 불러오지 못했습니다",
          );
        }
      }
      if (cancelled) return;
      controllerRef.current = createCanvasController(fallback!, start, radius);
      setUsingFallback(true);
      propsRef.current.onFallbackMap();
      setReady(true);
    }

    void init();

    return () => {
      cancelled = true;
      controllerRef.current?.destroy();
      controllerRef.current = null;
      // StrictMode의 이중 마운트에서 SDK가 만든 DOM이 남지 않도록 비웁니다
      if (host) host.innerHTML = "";
      setReady(false);
    };
  }, [jsKey]);

  /* ── 뷰 변경·리사이즈·테마 구독 ───────────────────── */

  useEffect(() => {
    if (!ready) return;
    const controller = controllerRef.current;
    const stage = stageRef.current;
    if (!controller || !stage) return;

    renderStatic();

    const unsubscribe = controller.subscribe(() => {
      drawDots();
      if (controller.kind === "canvas") {
        const s = stageRef.current;
        if (s) controller.redraw(readMapPalette(s));
      }
    });

    const observer = new ResizeObserver(() => {
      controller.resize();
      renderStatic();
    });
    observer.observe(stage);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onTheme = () => renderStatic();
    media.addEventListener("change", onTheme);

    return () => {
      unsubscribe();
      observer.disconnect();
      media.removeEventListener("change", onTheme);
    };
  }, [ready, renderStatic, drawDots]);

  /** 후보가 갱신되면 점만 다시 */
  useEffect(() => {
    if (ready) drawDots();
  }, [ready, props.candidates, drawDots]);

  /** 기준점·반경이 바뀌면 화면을 다시 맞춥니다 (좌표값 기준 — 객체 신원 무시) */
  const baseLat = props.base?.lat;
  const baseLng = props.base?.lng;
  useEffect(() => {
    if (!ready || baseLat === undefined || baseLng === undefined) return;
    controllerRef.current?.fitRadius({ lat: baseLat, lng: baseLng }, props.radiusM);
    renderStatic();
  }, [ready, baseLat, baseLng, props.radiusM, renderStatic]);

  /** 비행 중에는 지도 조작을 잠급니다 */
  useEffect(() => {
    if (!ready) return;
    controllerRef.current?.setInteractive(props.phase === "idle" && !props.placeMode);
  }, [ready, props.phase, props.placeMode]);

  /** 다시 던지기로 idle에 돌아오면 블러를 초기화합니다 */
  useEffect(() => {
    if (props.phase === "idle") {
      setBlur(0, 200);
      ripplesRef.current = [];
    }
  }, [props.phase, setBlur]);

  /** 당첨 핀 등장 시각 — 팝인 애니메이션 기준점 */
  useEffect(() => {
    pinShownAtRef.current = props.winner ? performance.now() : 0;
  }, [props.winner]);

  /* ── 던지기 ───────────────────────────────────────── */

  const startFlight = useCallback(
    (plan: ThrowPlan) => {
      const startedAt = performance.now();
      if (startedAt - lastThrowRef.current < THROW_COOLDOWN_MS) return;
      lastThrowRef.current = startedAt;

      const longest = Math.max(...plan.hopMeters);
      const durations = plan.hopMeters.map((m) => hopDurationMs(m, longest));

      propsRef.current.onThrowStart();
      ripplesRef.current = [];
      setBlur(PHYSICS.blurStartPx, 180);

      if (prefersReducedMotion()) {
        flightRef.current = null;
        setBlur(0, 200);
        window.setTimeout(() => propsRef.current.onLanded(plan), 160);
        return;
      }

      const now = performance.now();
      flightRef.current = {
        plan,
        durations,
        hopIndex: 0,
        hopStart: now,
        hopEnd: now + (durations[0] ?? PHYSICS.hopMinMs),
      };
    },
    [setBlur],
  );

  const localPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
    const canvas = overlayRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const { phase, base, placeMode } = propsRef.current;
      if (placeMode || phase !== "idle" || !base) return;
      const pt = localPoint(e);
      aimRef.current = { active: true, x: pt.x, y: pt.y };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [localPoint],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!aimRef.current.active) return;
      const pt = localPoint(e);
      aimRef.current.x = pt.x;
      aimRef.current.y = pt.y;
    },
    [localPoint],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const controller = controllerRef.current;
      const { phase, base, placeMode, radiusM } = propsRef.current;
      const pt = localPoint(e);

      if (placeMode) {
        if (controller) propsRef.current.onPickBase(controller.unproject(pt));
        aimRef.current.active = false;
        return;
      }

      if (!aimRef.current.active) return;
      aimRef.current.active = false;
      if (phase !== "idle" || !base || !controller) return;

      const basePt = controller.project(base);
      const aim = pullToAim(pt.x - basePt.x, pt.y - basePt.y);
      // 살짝 눌린 정도는 던진 게 아니라 탭으로 봅니다
      if (aim.power < 0.08) return;

      startFlight(planThrow(base, radiusM, aim, Math.random));
    },
    [localPoint, startFlight],
  );

  const onPointerCancel = useCallback(() => {
    aimRef.current.active = false;
  }, []);

  /** 접근성·키보드 대체 수단 — 방향을 무작위로 골라 최대에 가까운 힘으로 던집니다 */
  const throwBlind = useCallback(() => {
    const { phase, base, radiusM } = propsRef.current;
    if (phase !== "idle" || !base) return;
    startFlight(
      planThrow(
        base,
        radiusM,
        { power: 0.55 + Math.random() * 0.4, bearingRad: Math.random() * Math.PI * 2 },
        Math.random,
      ),
    );
  }, [startFlight]);

  useEffect(() => {
    if (props.blindThrowNonce > 0) throwBlind();
    // nonce가 바뀔 때만 던집니다
  }, [props.blindThrowNonce, throwBlind]);

  /* ── 오버레이 렌더 루프 ───────────────────────────── */

  useEffect(() => {
    if (!ready) return;
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);

      const canvas = overlayRef.current;
      const controller = controllerRef.current;
      const palette = paletteRef.current;
      if (!canvas || !controller || !palette) return;

      const dpr = sizeCanvas(canvas);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const { base, radiusM, phase, landing, winner } = propsRef.current;
      if (!base) return;

      const view = controller.getView();
      const pxPerM = 1 / view.metersPerPixel;
      const basePt = controller.project(base);
      const now = performance.now();

      // 1. 반경 원 — 비행 중에도 선명하게 남겨서 경계가 보이게 합니다
      ctx.save();
      ctx.setLineDash([7, 6]);
      ctx.strokeStyle = palette.water;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(basePt.x, basePt.y, radiusM * pxPerM, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // 2. 기준점
      ctx.save();
      ctx.fillStyle = palette.water;
      ctx.beginPath();
      ctx.arc(basePt.x, basePt.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = palette.surface;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // 3. 조준 콘 — 예상 착지점 대신 "이만큼 흔들린다"를 보여줍니다
      const aim = aimRef.current;
      if (aim.active && phase === "idle") {
        const dx = aim.x - basePt.x;
        const dy = aim.y - basePt.y;
        const resolved = pullToAim(dx, dy);
        if (resolved.power > 0.04) {
          const reach = expectedDistanceM(radiusM, resolved.power) * pxPerM;
          const half = aimConeHalfAngle();
          const wobble = Math.sin(now / 95) * 0.022;
          const mid = bearingToCanvasAngle(resolved.bearingRad) + wobble;

          const grad = ctx.createRadialGradient(
            basePt.x,
            basePt.y,
            0,
            basePt.x,
            basePt.y,
            Math.max(reach, 1),
          );
          grad.addColorStop(0, `${palette.water}00`);
          grad.addColorStop(1, palette.water);

          ctx.save();
          ctx.globalAlpha = 0.24;
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(basePt.x, basePt.y);
          ctx.arc(basePt.x, basePt.y, reach, mid - half, mid + half);
          ctx.closePath();
          ctx.fill();

          ctx.globalAlpha = 0.7;
          ctx.strokeStyle = palette.water;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(basePt.x, basePt.y);
          ctx.lineTo(aim.x, aim.y);
          ctx.stroke();
          ctx.restore();
        }
      }

      // 4. 비행 진행 — 홉 경계를 넘었으면 바운스 처리
      const flight = flightRef.current;
      if (flight) {
        while (flight.hopIndex < flight.plan.points.length && now >= flight.hopEnd) {
          const landedAt = flight.plan.points[flight.hopIndex];
          if (landedAt) ripplesRef.current.push({ at: landedAt, t0: flight.hopEnd });

          const done = flight.hopIndex + 1;
          const isFinal = done >= flight.plan.points.length;
          setBlur(blurAfterBounce(done, flight.plan.bounces), isFinal ? 460 : 190);
          flight.hopIndex = done;

          if (isFinal) {
            const plan = flight.plan;
            flightRef.current = null;
            propsRef.current.onLanded(plan);
            break;
          }
          flight.hopStart = flight.hopEnd;
          flight.hopEnd =
            flight.hopStart + (flight.durations[flight.hopIndex] ?? PHYSICS.hopMinMs);
        }
      }

      // 5. 파문
      ctx.save();
      for (const ripple of ripplesRef.current) {
        const age = now - ripple.t0;
        if (age < 0 || age > RIPPLE_LIFE_MS) continue;
        const t = age / RIPPLE_LIFE_MS;
        const pt = controller.project(ripple.at);
        ctx.globalAlpha = (1 - t) * 0.65;
        ctx.strokeStyle = palette.gold;
        ctx.lineWidth = 2 * (1 - t) + 0.6;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 5 + t * 26, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      if (ripplesRef.current.length > 8) {
        ripplesRef.current = ripplesRef.current.filter(
          (r) => now - r.t0 < RIPPLE_LIFE_MS,
        );
      }

      // 6. 돌
      const active = flightRef.current;
      if (active) {
        const from =
          active.hopIndex === 0
            ? base
            : (active.plan.points[active.hopIndex - 1] ?? base);
        const to = active.plan.points[active.hopIndex];
        if (to) {
          const span = Math.max(1, active.hopEnd - active.hopStart);
          const t = Math.min(1, Math.max(0, (now - active.hopStart) / span));
          const a = controller.project(from);
          const b = controller.project(to);
          const groundX = a.x + (b.x - a.x) * t;
          const groundY = a.y + (b.y - a.y) * t;
          const hopPx = Math.hypot(b.x - a.x, b.y - a.y);
          const lift = Math.sin(Math.PI * t) * hopPx * PHYSICS.arcRatio;

          ctx.save();
          // 바닥 그림자
          ctx.globalAlpha = 0.2;
          ctx.fillStyle = palette.ink;
          ctx.beginPath();
          ctx.ellipse(groundX, groundY, 5.5, 2.4, 0, 0, Math.PI * 2);
          ctx.fill();

          // 돌
          ctx.globalAlpha = 1;
          ctx.fillStyle = palette.stone;
          ctx.beginPath();
          ctx.ellipse(groundX, groundY - lift, 5.4, 4.4, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = palette.surface;
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.restore();
        }
      }

      // 7. 착지점 판정 반경
      const revealing = phase === "reveal" || phase === "result";
      if (revealing && landing) {
        const pt = controller.project(landing);
        ctx.save();
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = palette.gold;
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, revealRadiusM(radiusM) * pxPerM, 0, Math.PI * 2);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pt.x - 5, pt.y - 5);
        ctx.lineTo(pt.x + 5, pt.y + 5);
        ctx.moveTo(pt.x + 5, pt.y - 5);
        ctx.lineTo(pt.x - 5, pt.y + 5);
        ctx.stroke();
        ctx.restore();
      }

      // 8. 당첨 핀 — flare는 여기에만 씁니다
      if (revealing && winner) {
        const pt = controller.project(winner);
        const age = pinShownAtRef.current ? now - pinShownAtRef.current : 999;
        const t = Math.min(1, age / 320);
        // 살짝 튀어오르는 오버슈트
        const scale = t < 1 ? 1 + Math.sin(Math.PI * t) * 0.45 * (1 - t) : 1;
        const grow = Math.min(1, age / 200);

        ctx.save();
        ctx.translate(pt.x, pt.y);
        ctx.scale(grow * scale, grow * scale);

        // 맥동 링
        const pulse = (age % 1600) / 1600;
        ctx.globalAlpha = (1 - pulse) * 0.5;
        ctx.strokeStyle = palette.flare;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 8 + pulse * 22, 0, Math.PI * 2);
        ctx.stroke();

        // 핀
        ctx.globalAlpha = 1;
        ctx.fillStyle = palette.flare;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-5.5, -16);
        ctx.lineTo(5.5, -16);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, -22, 9.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = palette.surface;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = palette.surface;
        ctx.beginPath();
        ctx.arc(0, -22, 3.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [ready, sizeCanvas, setBlur]);

  return (
    <div
      ref={stageRef}
      className={`stage${props.placeMode ? " place-mode" : ""}`}
      data-map={usingFallback ? "sample" : "kakao"}
    >
      <div ref={layerRef} className="map-layer">
        <div
          ref={kakaoHostRef}
          className="map-fill"
          style={{ display: usingFallback ? "none" : "block" }}
        />
        <canvas
          ref={fallbackRef}
          className="map-fill"
          style={{ display: usingFallback ? "block" : "none" }}
        />
        <canvas ref={dotsRef} className="map-fill" />
      </div>

      <canvas
        ref={overlayRef}
        className="overlay"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />
    </div>
  );
}
