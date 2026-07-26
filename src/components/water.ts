import { WATER } from "@/lib/config";
import type { OverlayPalette } from "@/lib/palette";
import { mulberry32 } from "@/lib/prng";
import type { LatLng, Point } from "@/lib/types";

/**
 * 수면·돌·물보라 렌더링. MapStage의 그리기 루프에서만 호출되는 순수 그리기
 * 함수들이라 상태를 갖지 않습니다 — 컴포넌트에서 분리해 두면 연출을 손볼 때
 * 게임 로직을 건드릴 일이 없습니다.
 */

export interface Splash {
  at: LatLng;
  t0: number;
  drops: { angle: number; speed: number }[];
}

export interface TrailPoint {
  at: LatLng;
  t: number;
}

/** 던질 때마다 다른 모양의 조약돌. 프레임마다 새로 뽑으면 모양이 떨려서 미리 만듭니다. */
export function makeStoneShape(seed: number): number[] {
  const rand = mulberry32(seed);
  const points = 11;
  const shape: number[] = [];
  for (let i = 0; i < points; i++) shape.push(0.82 + rand() * 0.34);
  return shape;
}

export function makeSplash(at: LatLng, t0: number, seed: number): Splash {
  const rand = mulberry32(seed);
  const count = 6 + Math.floor(rand() * 4);
  const drops: Splash["drops"] = [];
  for (let i = 0; i < count; i++) {
    drops.push({
      angle: (i / count) * Math.PI * 2 + rand() * 0.7,
      speed: 0.6 + rand() * 0.7,
    });
  }
  return { at, t0, drops };
}

/**
 * 지도를 덮는 수면. level 0이면 아무것도 그리지 않고, 1이면 완전히 덮습니다.
 * 서로 다른 주기와 속도의 사인파를 겹쳐 넘실대는 느낌을 냅니다.
 */
export function drawWater(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  level: number,
  now: number,
  palette: OverlayPalette,
  basePoint: Point,
): void {
  ctx.save();

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, palette.wave);
  gradient.addColorStop(1, palette.waveDeep);
  ctx.globalAlpha = level * 0.92;
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // 물결
  ctx.strokeStyle = palette.foam;
  ctx.lineWidth = 1.4;
  for (let i = 0; i < WATER.caustics; i++) {
    const yBase = ((i + 0.5) / WATER.caustics) * height;
    const amplitude = 7 + i * 2.4;
    const period = 150 + i * 55;
    const drift = now * (0.00024 + i * 0.00005);

    ctx.globalAlpha = level * (0.17 - i * 0.012);
    ctx.beginPath();
    for (let x = 0; x <= width; x += 10) {
      const y =
        yBase +
        Math.sin(x / period + drift * 6 + i) * amplitude +
        Math.sin(x / (period * 0.37) - drift * 4) * amplitude * 0.4;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // 기준점에서 천천히 퍼지는 파동 — 던지기 전의 정적을 만듭니다
  ctx.lineWidth = 1.6;
  for (let k = 0; k < 3; k++) {
    const phase = (now / 2600 + k / 3) % 1;
    ctx.globalAlpha = level * (1 - phase) * 0.32;
    ctx.beginPath();
    ctx.arc(basePoint.x, basePoint.y, 12 + phase * 118, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

/** 돌이 수면을 스치며 남기는 항적 */
export function drawTrail(
  ctx: CanvasRenderingContext2D,
  trail: TrailPoint[],
  now: number,
  project: (at: LatLng) => Point,
  palette: OverlayPalette,
): void {
  if (trail.length < 2) return;
  ctx.save();
  ctx.strokeStyle = palette.foam;
  ctx.lineCap = "round";

  for (let i = 1; i < trail.length; i++) {
    const previous = trail[i - 1]!;
    const current = trail[i]!;
    const age = now - current.t;
    if (age > WATER.trailLifeMs) continue;

    const fade = 1 - age / WATER.trailLifeMs;
    const a = project(previous.at);
    const b = project(current.at);
    ctx.globalAlpha = fade * 0.34;
    ctx.lineWidth = fade * 2.6 + 0.4;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

/** 바운스 지점의 물보라 — 이중 파문 + 튀는 물방울 */
export function drawSplashes(
  ctx: CanvasRenderingContext2D,
  splashes: Splash[],
  now: number,
  project: (at: LatLng) => Point,
  palette: OverlayPalette,
): void {
  ctx.save();
  for (const splash of splashes) {
    const age = now - splash.t0;
    if (age < 0 || age > WATER.splashLifeMs) continue;
    const point = project(splash.at);

    for (let ring = 0; ring < 2; ring++) {
      const t = Math.min(1, (age / WATER.splashLifeMs) * (1 + ring * 0.5));
      const eased = 1 - Math.pow(1 - t, 2.2);
      ctx.globalAlpha = (1 - t) * (ring === 0 ? 0.72 : 0.34);
      ctx.strokeStyle = palette.foam;
      ctx.lineWidth = (1 - t) * 2.4 + 0.5;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4 + eased * (26 + ring * 22), 0, Math.PI * 2);
      ctx.stroke();
    }

    if (age <= WATER.dropLifeMs) {
      const t = age / WATER.dropLifeMs;
      ctx.fillStyle = palette.foam;
      for (const drop of splash.drops) {
        const distance = drop.speed * t * 28;
        const x = point.x + Math.cos(drop.angle) * distance;
        // 위에서 내려다보는 시점이라 세로 이동을 줄이고, 대신 살짝 떠오르게
        const y =
          point.y + Math.sin(drop.angle) * distance * 0.55 - Math.sin(Math.PI * t) * 11;
        ctx.globalAlpha = (1 - t) * 0.85;
        ctx.beginPath();
        ctx.arc(x, y, (1 - t) * 2.2 + 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

/**
 * 당긴 세기 게이지. 기준점을 감싸는 270° 링으로 그립니다.
 *
 * 손가락이 화면을 가리기 때문에 포인터가 아니라 **기준점 주위**에 둡니다.
 * 최대치에 닿으면 색이 금색으로 바뀌고 맥동해서, 숫자 없이도 "더 당겨도 소용없다"를
 * 알 수 있습니다.
 */
export function drawPowerGauge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  power: number,
  palette: OverlayPalette,
  now: number,
): void {
  const radius = 30;
  const start = Math.PI * 0.75;
  const sweep = Math.PI * 1.5;
  const filled = Math.min(1, Math.max(0, power));
  const maxed = filled >= 0.995;

  ctx.save();
  ctx.lineCap = "round";

  // 트랙
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = palette.surface;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, start + sweep);
  ctx.stroke();

  // 눈금 — 절반 지점
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 2;
  ctx.strokeStyle = palette.ink;
  const half = start + sweep * 0.5;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(half) * (radius - 5), cy + Math.sin(half) * (radius - 5));
  ctx.lineTo(cx + Math.cos(half) * (radius + 5), cy + Math.sin(half) * (radius + 5));
  ctx.stroke();

  // 채움
  if (filled > 0.001) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = maxed ? palette.gold : palette.water;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, start + sweep * filled);
    ctx.stroke();
  }

  // 최대치 맥동
  if (maxed) {
    const pulse = (now % 700) / 700;
    ctx.globalAlpha = (1 - pulse) * 0.5;
    ctx.strokeStyle = palette.gold;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + pulse * 12, start, start + sweep);
    ctx.stroke();
  }

  ctx.restore();
}

/** 슬링샷 밴드 — 기준점에서 손가락까지 당겨진 줄과 그 끝의 돌 */
export function drawPullBand(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  palette: OverlayPalette,
): void {
  ctx.save();
  ctx.lineCap = "round";

  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = palette.water;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = palette.surface;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  // 손가락 끝의 돌
  ctx.globalAlpha = 1;
  const shade = ctx.createLinearGradient(toX - 7, toY - 7, toX + 7, toY + 7);
  shade.addColorStop(0, palette.stoneLit);
  shade.addColorStop(0.55, palette.stone);
  shade.addColorStop(1, palette.stoneDark);
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.ellipse(toX, toY, 7.5, 5.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = palette.surface;
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.restore();
}

/**
 * 납작한 조약돌. 위에서 내려다보므로 세로를 눌러 그리고, 나는 동안 회전시켜
 * 물수제비 특유의 스핀을 만듭니다.
 */
export function drawStone(
  ctx: CanvasRenderingContext2D,
  groundX: number,
  groundY: number,
  lift: number,
  rotation: number,
  shape: number[],
  palette: OverlayPalette,
): void {
  const radius = 7.2;

  ctx.save();
  // 수면에 비치는 그림자 — 높이 오를수록 흐려지고 커집니다
  const height = Math.max(0, lift);
  ctx.globalAlpha = 0.26 / (1 + height * 0.045);
  ctx.fillStyle = palette.waveDeep;
  ctx.beginPath();
  ctx.ellipse(
    groundX,
    groundY,
    radius * (1 + height * 0.018),
    radius * 0.42 * (1 + height * 0.018),
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(groundX, groundY - lift);
  ctx.rotate(rotation);
  ctx.scale(1, 0.62);

  ctx.beginPath();
  for (let i = 0; i < shape.length; i++) {
    const angle = (i / shape.length) * Math.PI * 2;
    const r = radius * shape[i]!;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();

  const shade = ctx.createLinearGradient(-radius, -radius, radius, radius);
  shade.addColorStop(0, palette.stoneLit);
  shade.addColorStop(0.55, palette.stone);
  shade.addColorStop(1, palette.stoneDark);
  ctx.fillStyle = shade;
  ctx.fill();

  ctx.strokeStyle = palette.stoneDark;
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.restore();
}
