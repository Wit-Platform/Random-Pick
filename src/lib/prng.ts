/**
 * 결정론적 난수. 같은 좌표를 조회하면 누구에게나 같은 샘플 식당이 나와야 하므로
 * Math.random이 아니라 시드 가능한 PRNG를 씁니다.
 */

/** 정수 여러 개를 32bit 시드로 접기 (FNV-1a 변형) */
export function hashInts(...nums: number[]): number {
  let h = 2_166_136_261 >>> 0;
  for (const n of nums) {
    let x = Math.imul(n | 0, 2_654_435_761) >>> 0;
    x ^= x >>> 13;
    h = (h ^ x) >>> 0;
    h = Math.imul(h, 16_777_619) >>> 0;
    h ^= h >>> 15;
  }
  return h >>> 0;
}

export function hashString(s: string): number {
  let h = 2_166_136_261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16_777_619) >>> 0;
  }
  return h >>> 0;
}

export type Rand = () => number;

/** mulberry32 — 짧고 분포가 충분히 고르며 시드 재현이 보장됩니다. */
export function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return function rand(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** [min, max) 균등 */
export function uniform(rand: Rand, min: number, max: number): number {
  return min + rand() * (max - min);
}

/** [min, max] 정수 균등 */
export function randInt(rand: Rand, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

export function pick<T>(rand: Rand, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error("pick from empty array");
  return arr[Math.floor(rand() * arr.length) % arr.length] as T;
}

/** 표준정규 (Box–Muller). 던지기 각도 노이즈에 사용 */
export function gaussian(rand: Rand): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
