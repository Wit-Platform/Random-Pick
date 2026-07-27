"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_BASE, PHYSICS, THROW_COOLDOWN_MS, WATER } from "@/lib/config";
import {
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
import type { LatLng, Phase, Place, Point } from "@/lib/types";
import { createCanvasController } from "@/map/canvas-map";
import { createKakaoController, loadKakaoSdk } from "@/map/kakao";
import type { MapController } from "@/map/types";

import {
  drawPowerGauge,
  drawPullBand,
  drawSplashes,
  drawStone,
  drawTrail,
  drawWater,
  makeSplash,
  makeStoneShape,
  type Splash,
  type TrailPoint,
} from "./water";

export interface MapStageProps {
  jsKey: string;
  base: LatLng | null;
  radiusM: number;
  phase: Phase;
  placeMode: boolean;
  /** 리빌 결과. 첫 번째가 가장 가까운 곳이고 pickedIndex가 지금 고른 곳입니다 */
  results: Place[];
  pickedIndex: number;
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
  const overlayRef = useRef<HTMLCanvasElement | null>(null);

  const controllerRef = useRef<MapController | null>(null);
  const paletteRef = useRef<OverlayPalette | null>(null);

  const aimRef = useRef<{ active: boolean; x: number; y: number }>({
    active: false,
    x: 0,
    y: 0,
  });
  const flightRef = useRef<Flight | null>(null);
  const splashesRef = useRef<Splash[]>([]);
  const trailRef = useRef<TrailPoint[]>([]);
  const pinShownAtRef = useRef(0);
  /** 연타 방지. 던지기 1회 = 리빌 조회 1회라 서버 쿼터와 직결됩니다 */
  const lastThrowRef = useRef(0);
  /** 수면 불투명도. 목표치로 매 프레임 수렴합니다 */
  const waterRef = useRef(0);
  /** 이번 던지기의 조약돌 모양 (프레임마다 다시 뽑으면 모양이 떨립니다) */
  const stoneShapeRef = useRef<number[]>(makeStoneShape(1));
  const throwStartedAtRef = useRef(0);

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

  /** 폴백 지도를 다시 그립니다 (뷰·테마 변경 시) */
  const renderStatic = useCallback(() => {
    const stage = stageRef.current;
    const controller = controllerRef.current;
    if (!stage || !controller) return;
    paletteRef.current = readOverlayPalette(stage);
    controller.redraw(readMapPalette(stage));
  }, []);

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
  }, [ready, renderStatic]);

  /** 기준점·반경이 바뀌면 화면을 다시 맞춥니다 (좌표값 기준 — 객체 신원 무시) */
  const baseLat = props.base?.lat;
  const baseLng = props.base?.lng;
  useEffect(() => {
    if (!ready || baseLat === undefined || baseLng === undefined) return;
    controllerRef.current?.fitRadius({ lat: baseLat, lng: baseLng }, props.radiusM);
    renderStatic();
  }, [ready, baseLat, baseLng, props.radiusM, renderStatic]);

  /**
   * 비행 중에만 지도 조작을 잠급니다.
   *
   * 예전에는 place mode에서도 잠갔는데, 기준점을 찍으려면 지도를 옮겨 보면서 찾아야
   * 하므로 정확히 반대로 해야 합니다.
   */
  useEffect(() => {
    if (!ready) return;
    controllerRef.current?.setInteractive(props.phase !== "flying");
  }, [ready, props.phase]);

  /**
   * place mode에서는 지도가 클릭을 처리합니다. 오버레이 캔버스는 pointer-events를
   * 끄기 때문에(아래 JSX) 끌기·확대가 지도로 그대로 전달되고, 탭한 지점만 받아옵니다.
   */
  useEffect(() => {
    if (!ready || !props.placeMode) return;
    const controller = controllerRef.current;
    if (!controller) return;
    return controller.onClick((at) => propsRef.current.onPickBase(at));
  }, [ready, props.placeMode]);

  /** 다시 던지기로 idle에 돌아오면 블러와 물보라를 초기화합니다 */
  useEffect(() => {
    if (props.phase === "idle") {
      setBlur(0, 200);
      splashesRef.current = [];
      trailRef.current = [];
    }
  }, [props.phase, setBlur]);

  /** 핀 등장 시각 — 팝인 애니메이션 기준점 */
  useEffect(() => {
    pinShownAtRef.current = props.results.length > 0 ? performance.now() : 0;
  }, [props.results]);

  /* ── 던지기 ───────────────────────────────────────── */

  const startFlight = useCallback(
    (plan: ThrowPlan) => {
      const startedAt = performance.now();
      if (startedAt - lastThrowRef.current < THROW_COOLDOWN_MS) return;
      lastThrowRef.current = startedAt;

      const longest = Math.max(...plan.hopMeters);
      const durations = plan.hopMeters.map((m) => hopDurationMs(m, longest));

      propsRef.current.onThrowStart();
      splashesRef.current = [];
      trailRef.current = [];
      stoneShapeRef.current = makeStoneShape(Math.floor(Math.random() * 2 ** 31));
      throwStartedAtRef.current = startedAt;
      setBlur(PHYSICS.blurStartPx, 180);

      if (prefersReducedMotion()) {
        flightRef.current = null;
        setBlur(0, 200);
        window.setTimeout(() => propsRef.current.onLanded(plan), 160);
        return;
      }

      flightRef.current = {
        plan,
        durations,
        hopIndex: 0,
        hopStart: startedAt,
        hopEnd: startedAt + (durations[0] ?? PHYSICS.hopMinMs),
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
      // 힌트 말풍선이 당기는 자리를 가리므로 조준 중에는 숨깁니다.
      // ref로 직접 표시해서 드래그 중 리렌더를 만들지 않습니다.
      if (stageRef.current) stageRef.current.dataset.aiming = "true";
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
      const { phase, base, radiusM } = propsRef.current;
      const pt = localPoint(e);

      if (stageRef.current) delete stageRef.current.dataset.aiming;

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
    if (stageRef.current) delete stageRef.current.dataset.aiming;
  }, []);

  /** 접근성·키보드 대체 수단 — 방향을 무작위로 골라 최대에 가까운 힘으로 던집니다 */
  const throwBlind = useCallback(() => {
    const { phase, base, radiusM } = propsRef.current;
    if (phase !== "idle" || !base) return;
    startFlight(
      planThrow(
        base,
        radiusM,
        { power: 0.3 + Math.random() * 0.65, bearingRad: Math.random() * Math.PI * 2 },
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
    // 매 프레임 matchMedia를 만들지 않도록 한 번만 읽습니다
    const reduced = prefersReducedMotion();

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

      const { base, radiusM, phase, landing, results, pickedIndex } =
        propsRef.current;
      if (!base) return;

      const view = controller.getView();
      const pxPerM = 1 / view.metersPerPixel;
      const basePt = controller.project(base);
      const now = performance.now();
      const project = (at: LatLng) => controller.project(at);

      // 1. 비행 진행 — 그리기 전에 상태를 확정합니다 (수면 높이가 여기에 달려 있음)
      const flight = flightRef.current;
      if (flight) {
        while (flight.hopIndex < flight.plan.points.length && now >= flight.hopEnd) {
          const landedAt = flight.plan.points[flight.hopIndex];
          if (landedAt) {
            splashesRef.current.push(
              makeSplash(landedAt, flight.hopEnd, flight.hopIndex * 7919 + 13),
            );
          }

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

      const active = flightRef.current;

      // 2. 수면 — 조준하면 물이 차오르고, 바운스마다 빠지면서 지도가 드러납니다
      let waterTarget = 0;
      if (!reduced) {
        if (phase === "idle" && aimRef.current.active) {
          waterTarget = WATER.aimLevel;
        } else if (phase === "flying") {
          waterTarget = active
            ? 1 - active.hopIndex / Math.max(1, active.plan.bounces)
            : 0;
        }
      }
      const waterEase =
        waterTarget > waterRef.current ? WATER.easeRise : WATER.easeFall;
      waterRef.current += (waterTarget - waterRef.current) * waterEase;
      if (waterRef.current > 0.004) {
        drawWater(ctx, w, h, waterRef.current, now, palette, basePt);
      } else {
        waterRef.current = 0;
      }

      // 3. 반경 원 — 비행 중에도 선명하게 남겨서 경계가 보이게 합니다
      ctx.save();
      ctx.setLineDash([7, 6]);
      ctx.strokeStyle = palette.water;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(basePt.x, basePt.y, radiusM * pxPerM, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // 4. 기준점
      ctx.save();
      ctx.fillStyle = palette.water;
      ctx.beginPath();
      ctx.arc(basePt.x, basePt.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = palette.surface;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // 5. 조준 — 흔들림 부채꼴 + 슬링샷 밴드 + 세기 게이지
      const aim = aimRef.current;
      if (aim.active && phase === "idle") {
        const dx = aim.x - basePt.x;
        const dy = aim.y - basePt.y;
        const resolved = pullToAim(dx, dy);

        if (resolved.power > 0.02) {
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
          ctx.globalAlpha = 0.26;
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(basePt.x, basePt.y);
          ctx.arc(basePt.x, basePt.y, reach, mid - half, mid + half);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }

        drawPullBand(ctx, basePt.x, basePt.y, aim.x, aim.y, palette);
        drawPowerGauge(ctx, basePt.x, basePt.y, resolved.power, palette, now);
      }

      // 6. 항적과 물보라 — 돌이 사라진 뒤에도 잔상이 남습니다
      drawTrail(ctx, trailRef.current, now, project, palette);
      drawSplashes(ctx, splashesRef.current, now, project, palette);
      if (splashesRef.current.length > 8) {
        splashesRef.current = splashesRef.current.filter(
          (s) => now - s.t0 < WATER.splashLifeMs,
        );
      }

      // 7. 돌 — 수면을 스치는 납작한 조약돌
      if (active) {
        const from =
          active.hopIndex === 0
            ? base
            : (active.plan.points[active.hopIndex - 1] ?? base);
        const to = active.plan.points[active.hopIndex];
        if (to) {
          const span = Math.max(1, active.hopEnd - active.hopStart);
          const t = Math.min(1, Math.max(0, (now - active.hopStart) / span));

          // 위치는 위경도로 보관합니다 — 리사이즈·재투영에 안전해야 하므로
          const at: LatLng = {
            lat: from.lat + (to.lat - from.lat) * t,
            lng: from.lng + (to.lng - from.lng) * t,
          };
          trailRef.current.push({ at, t: now });
          if (trailRef.current.length > WATER.trailPoints) trailRef.current.shift();

          const a = controller.project(from);
          const b = controller.project(to);
          const hopPx = Math.hypot(b.x - a.x, b.y - a.y);
          const point = controller.project(at);
          const lift = Math.sin(Math.PI * t) * hopPx * PHYSICS.arcRatio;
          const spin = (now - throwStartedAtRef.current) * 0.009;

          drawStone(
            ctx,
            point.x,
            point.y,
            lift,
            spin,
            stoneShapeRef.current,
            palette,
          );
        }
      }

      // 8. 착지점 판정 반경
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

      // 9. 결과 핀 — flare는 여기에만 씁니다. 고른 곳이 가장 크고 선명합니다
      if (revealing && results.length > 0) {
        const age = pinShownAtRef.current ? now - pinShownAtRef.current : 999;

        /**
         * 가까운 곳들이라 핀이 겹칩니다. 고른 핀을 **맨 마지막에** 그려 항상 위로
         * 올립니다 — 뒤 순번을 골랐는데 1번에 가려지면 뭘 고른 건지 알 수 없습니다.
         */
        const order = results.map((_, i) => i).filter((i) => i !== pickedIndex);
        order.reverse();
        if (results[pickedIndex]) order.push(pickedIndex);

        for (const i of order) {
          const place = results[i];
          if (!place) continue;
          const pt = controller.project(place);
          const isPicked = i === pickedIndex;

          // 순서대로 조금씩 늦게 등장시켜 하나씩 꽂히는 느낌을 냅니다
          const delay = i * 90;
          const local = age - delay;
          if (local < 0) continue;
          const t = Math.min(1, local / 320);
          const overshoot = t < 1 ? 1 + Math.sin(Math.PI * t) * 0.4 * (1 - t) : 1;
          const grow = Math.min(1, local / 200);
          const scale = grow * overshoot * (isPicked ? 1 : 0.78);

          ctx.save();
          ctx.translate(pt.x, pt.y);
          ctx.scale(scale, scale);

          if (isPicked) {
            const pulse = (local % 1600) / 1600;
            ctx.globalAlpha = (1 - pulse) * 0.5;
            ctx.strokeStyle = palette.flare;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, 8 + pulse * 22, 0, Math.PI * 2);
            ctx.stroke();
          }

          ctx.globalAlpha = isPicked ? 1 : 0.72;
          ctx.fillStyle = palette.flare;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(-5.5, -16);
          ctx.lineTo(5.5, -16);
          ctx.closePath();
          ctx.fill();
          ctx.beginPath();
          ctx.arc(0, -22, 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = palette.surface;
          ctx.lineWidth = 2;
          ctx.stroke();

          // 번호 — 목록의 순서와 맞춰 어느 핀인지 알 수 있게
          ctx.globalAlpha = 1;
          ctx.fillStyle = palette.surface;
          ctx.font = "700 12px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(i + 1), 0, -22);
          ctx.restore();
        }
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
      </div>

      <canvas
        ref={overlayRef}
        className="overlay"
        // place mode에서는 지도가 제스처를 받아야 합니다
        style={{ pointerEvents: props.placeMode ? "none" : "auto" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />
    </div>
  );
}
