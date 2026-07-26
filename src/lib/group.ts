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
    // ownerId를 떼고 mine 불리언으로만 내보냅니다
    ...stripOwner(entry, voterId),
    up: Math.max(0, Number(counts[i * 2] ?? 0)),
    down: Math.max(0, Number(counts[i * 2 + 1] ?? 0)),
    myVote: (mine[i] as VoteValue | null) ?? null,
  }));
}

/* ── 참가자 (presence) ──────────────────────────────────── */

/**
 * 계정도 연결도 없으므로 참가자는 **하트비트**로 파악합니다. 각 브라우저가 피드를
 * 폴링할 때 자기 닉네임을 함께 보내고, 이 시간 안에 소식이 없으면 목록에서 빠집니다.
 * 폴링 간격(5초)의 몇 배로 잡아 일시적인 네트워크 끊김에 사라지지 않게 합니다.
 */
const PRESENCE_TTL_MS = 25_000;

/**
 * 참가자 목록은 JSON 한 덩이로 둡니다.
 *
 * 동시에 두 명이 하트비트를 보내면 한쪽이 유실될 수 있지만, 5초 뒤 다음 하트비트가
 * 스스로 복구합니다. 투표와 달리 누적값이 아니라 **현재 상태**라서 이 방식이
 * 안전합니다. (투표는 유실되면 영구적이므로 카운터를 따로 씁니다)
 */
function membersKey(code: string): string {
  return `lunch:group:${code}:members`;
}

interface MemberRecord {
  nick: string;
  ts: number;
}

async function readMembers(
  code: string,
): Promise<Record<string, MemberRecord>> {
  try {
    const raw = await getStore().get(membersKey(code));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, MemberRecord>;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function prune(members: Record<string, MemberRecord>): Record<string, MemberRecord> {
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  const alive: Record<string, MemberRecord> = {};
  for (const [id, m] of Object.entries(members)) {
    if (m && typeof m.nick === "string" && m.ts > cutoff) alive[id] = m;
  }
  return alive;
}

/** 하트비트. 목록을 갱신하고 살아있는 참가자만 남깁니다. */
export async function touchMember(
  code: string,
  voterId: string,
  nick: string,
): Promise<void> {
  const members = prune(await readMembers(code));
  members[voterId] = { nick, ts: Date.now() };
  try {
    await getStore().set(
      membersKey(code),
      JSON.stringify(members),
      GROUP_TTL_SEC,
    );
  } catch {
    // 다음 하트비트가 다시 시도합니다
  }
}

export interface GroupMember {
  nick: string;
  /** 이 브라우저인지 — 목록에서 "나"로 표시합니다 */
  self: boolean;
}

/** 지금 방에 있는 사람들. 들어온 순서대로 돌려줍니다. */
export async function listMembers(
  code: string,
  selfId: string | null,
): Promise<GroupMember[]> {
  const members = prune(await readMembers(code));
  return Object.entries(members)
    .sort((a, b) => a[1].ts - b[1].ts)
    .map(([id, m]) => ({ nick: m.nick, self: id === selfId }));
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

/**
 * 카카오맵 링크만 허용합니다.
 *
 * 이 값은 **다른 참가자 화면에 클릭 가능한 링크로 렌더됩니다.** 검증하지 않으면
 * 누구나 임의의 주소를 방에 심을 수 있습니다(피싱·악성 링크). 호스트를 화이트리스트로
 * 제한하고 https만 받습니다.
 */
const KAKAO_PLACE_HOSTS = new Set([
  "place.map.kakao.com",
  "map.kakao.com",
  "m.place.map.kakao.com",
  "m.map.kakao.com",
]);

export function sanitizePlaceUrl(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 300) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!KAKAO_PLACE_HOSTS.has(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** 응답에서 서버 전용 필드를 떼고 mine 플래그로 바꿉니다 */
export function stripOwner(
  entry: GroupThrow,
  voterId: string | null,
): Omit<GroupThrow, "ownerId"> & { mine: boolean } {
  const { ownerId, ...rest } = entry;
  return { ...rest, mine: Boolean(voterId && ownerId === voterId) };
}

/**
 * 본인이 올린 항목만 지웁니다.
 *
 * 리스트에서 지우려면 저장된 문자열이 정확히 일치해야 하므로, 원본 문자열을 읽어
 * 파싱해 대조한 뒤 그 문자열로 LREM 합니다. 투표 카운터도 함께 지웁니다.
 * (누가 어떻게 투표했는지 기록한 키는 열거할 수 없어 12시간 만료에 맡깁니다)
 */
export async function deleteThrow(
  code: string,
  entryId: string,
  voterId: string,
): Promise<"deleted" | "forbidden" | "missing"> {
  const store = getStore();
  const key = throwsKey(code);
  const raw = await store.lrange(key, 0, -1);

  for (const line of raw) {
    let parsed: GroupThrow;
    try {
      parsed = JSON.parse(line) as GroupThrow;
    } catch {
      continue;
    }
    if (parsed.id !== entryId) continue;
    if (parsed.ownerId !== voterId) return "forbidden";

    await store.lrem(key, line);
    for (const v of ["up", "down"] as const) {
      await store.del(voteCountKey(code, entryId, v));
    }
    return "deleted";
  }
  return "missing";
}

/** 방 잠그기 — 만든 사람만 바꿀 수 있습니다 */
export async function setRoomLocked(
  code: string,
  voterId: string,
  locked: boolean,
): Promise<"ok" | "forbidden" | "missing"> {
  const condition = await loadCondition(code);
  if (!condition) return "missing";
  if (!condition.ownerId || condition.ownerId !== voterId) return "forbidden";
  await saveCondition(code, { ...condition, locked });
  return "ok";
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

  return {
    base: { lat, lng },
    radiusM,
    cats,
    createdAt: Date.now(),
    ownerId: sanitizeVoterId(b.voterId) ?? undefined,
    locked: false,
  };
}
