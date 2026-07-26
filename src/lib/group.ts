import { ALL_CATEGORY_IDS } from "./categories";
import { GROUP, RADIUS } from "./config";
import { getStore } from "./store";
import type {
  CategoryId,
  GroupCondition,
  GroupThrow,
  GroupThrowWithVotes,
  VoteValue,
} from "./types";

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

/**
 * 투표는 카운터와 투표자 기록을 나눠 둡니다.
 *
 * JSON 한 덩이로 읽고-쓰면 두 사람이 동시에 누를 때 한 표가 사라집니다.
 * 카운터는 INCR/DECR로 원자적으로 올리고, 누가 어떻게 눌렀는지는 별도 키에 둬서
 * 토글과 표 변경(붐업→붐따)을 정확히 계산합니다.
 */
function voteCountKey(code: string, entryId: string, value: VoteValue): string {
  return `lunch:group:${code}:v:${entryId}:${value}`;
}

function voterKey(code: string, entryId: string, voterId: string): string {
  return `lunch:group:${code}:voted:${entryId}:${voterId}`;
}

/** 투표자 식별자는 브라우저가 만든 임의 문자열입니다 — 계정이 없기 때문입니다 */
export function sanitizeVoterId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const id = input.trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : null;
}

/**
 * 표를 반영하고 바뀐 수를 돌려줍니다.
 * 같은 값을 다시 누르면 취소, 다른 값을 누르면 이동입니다.
 */
export async function castVote(
  code: string,
  entryId: string,
  voterId: string,
  value: VoteValue,
): Promise<{ up: number; down: number; myVote: VoteValue | null }> {
  const store = getStore();
  const vKey = voterKey(code, entryId, voterId);
  const previous = (await store.get(vKey)) as VoteValue | null;

  let next: VoteValue | null = value;
  if (previous === value) next = null; // 같은 걸 다시 누르면 취소

  if (previous && previous !== next) {
    await store.incr(voteCountKey(code, entryId, previous), -1);
  }
  if (next && next !== previous) {
    await store.incr(voteCountKey(code, entryId, next), 1);
  }

  if (next) await store.set(vKey, next, GROUP_TTL_SEC);
  else await store.del(vKey);

  for (const v of ["up", "down"] as const) {
    await store.expire(voteCountKey(code, entryId, v), GROUP_TTL_SEC);
  }

  const [up, down] = await store.mget([
    voteCountKey(code, entryId, "up"),
    voteCountKey(code, entryId, "down"),
  ]);

  return {
    up: Math.max(0, Number(up ?? 0)),
    down: Math.max(0, Number(down ?? 0)),
    myVote: next,
  };
}

/** 피드 항목마다 투표 수와 내 표를 붙입니다 (왕복 2회) */
export async function attachVotes(
  code: string,
  entries: GroupThrow[],
  voterId: string | null,
): Promise<GroupThrowWithVotes[]> {
  if (entries.length === 0) return [];
  const store = getStore();

  const countKeys = entries.flatMap((e) => [
    voteCountKey(code, e.id, "up"),
    voteCountKey(code, e.id, "down"),
  ]);
  const counts = await store.mget(countKeys);

  const mine = voterId
    ? await store.mget(entries.map((e) => voterKey(code, e.id, voterId)))
    : [];

  return entries.map((entry, i) => ({
    ...entry,
    up: Math.max(0, Number(counts[i * 2] ?? 0)),
    down: Math.max(0, Number(counts[i * 2 + 1] ?? 0)),
    myVote: (mine[i] as VoteValue | null) ?? null,
  }));
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

export function newThrowId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
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
