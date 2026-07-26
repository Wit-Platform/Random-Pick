import { ALL_CATEGORY_IDS } from "./categories";
import { GROUP, RADIUS } from "./config";
import { getStore } from "./store";
import type { CategoryId, GroupCondition, GroupThrow } from "./types";

/**
 * 그룹 플레이 저장 계층. Phase 2에서 UI가 붙을 자리이고, 지금은 서버 스키마와
 * 검증만 확정해 둡니다. 저장하는 값은 닉네임·식당명·카테고리·거리·시각뿐이며
 * **사용자의 실제 좌표는 저장하지 않습니다.**
 */

const GROUP_TTL_SEC = GROUP.ttlSec;
const MAX_FEED = GROUP.maxFeed;

export function conditionKey(code: string): string {
  return `lunch:group:${code}`;
}

export function throwsKey(code: string): string {
  return `lunch:group:${code}:throws`;
}

export async function saveCondition(
  code: string,
  condition: GroupCondition,
): Promise<void> {
  await getStore().set(
    conditionKey(code),
    JSON.stringify(condition),
    GROUP_TTL_SEC,
  );
}

export async function loadCondition(
  code: string,
): Promise<GroupCondition | null> {
  const raw = await getStore().get(conditionKey(code));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GroupCondition;
  } catch {
    return null;
  }
}

export async function appendThrow(
  code: string,
  entry: GroupThrow,
): Promise<void> {
  const store = getStore();
  const key = throwsKey(code);
  await store.rpush(key, JSON.stringify(entry));
  await store.ltrim(key, -MAX_FEED, -1);
  await store.expire(key, GROUP_TTL_SEC);
}

export async function loadThrows(code: string): Promise<GroupThrow[]> {
  const raw = await getStore().lrange(throwsKey(code), 0, -1);
  const out: GroupThrow[] = [];
  for (const line of raw) {
    try {
      out.push(JSON.parse(line) as GroupThrow);
    } catch {
      // 손상된 항목은 건너뜁니다
    }
  }
  return out;
}

export function sanitizeNick(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const nick = input.trim().slice(0, GROUP.maxNickLength);
  return nick.length > 0 ? nick : null;
}

/** 방 생성 요청 본문 검증. 좌표·반경·카테고리만 받습니다. */
export function parseCondition(body: unknown): GroupCondition | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const base = b.base as Record<string, unknown> | undefined;

  const lat = Number(base?.lat);
  const lng = Number(base?.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null;

  const radiusM = Number(b.radiusM);
  if (!Number.isFinite(radiusM) || radiusM < RADIUS.min || radiusM > RADIUS.max) {
    return null;
  }

  if (!Array.isArray(b.cats)) return null;
  const cats = b.cats.filter((c): c is CategoryId =>
    (ALL_CATEGORY_IDS as readonly string[]).includes(c as string),
  );
  if (cats.length === 0) return null;

  return { base: { lat, lng }, radiusM, cats, createdAt: Date.now() };
}
