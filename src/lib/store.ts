/**
 * 서버 전용 키-값 스토어. Upstash Redis가 설정되어 있으면 그걸 쓰고,
 * 없으면 프로세스 메모리로 폴백합니다.
 *
 * 메모리 폴백은 로컬 개발에는 충분하지만 서버리스에서는 인스턴스마다
 * 메모리가 달라 그룹 동기화에 쓸 수 없습니다. 그래서 `durable` 플래그를
 * 노출하고, false일 때 UI에서 그룹 기능을 숨깁니다.
 */

export interface Store {
  readonly durable: boolean;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  /** 카운터를 by만큼 올린 뒤 현재 값. rate limit·호출 예산에 사용 */
  incr(key: string, by?: number): Promise<number>;
  /** 남은 만료 시간(초). -1 = 만료 없음, -2 = 키 없음 (Redis 규약) */
  ttl(key: string): Promise<number>;
  rpush(key: string, value: string): Promise<void>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  ltrim(key: string, start: number, stop: number): Promise<void>;
  expire(key: string, ttlSec: number): Promise<void>;
}

/**
 * Vercel의 Upstash 통합은 버전에 따라 `UPSTASH_REDIS_REST_*` 또는 예전 Vercel KV
 * 이름인 `KV_REST_API_*`로 환경변수를 주입합니다. 둘 다 같은 Upstash REST 엔드포인트라
 * 어느 쪽이 와도 받습니다 — 한쪽만 읽으면 통합을 붙였는데도 조용히 메모리 폴백으로
 * 돌아가서 원인 찾기가 어렵습니다.
 *
 * `REDIS_URL`(redis:// 프로토콜)은 REST 클라이언트로 쓸 수 없으므로 받지 않습니다.
 */
function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

const UPSTASH_URL = firstEnv("UPSTASH_REDIS_REST_URL", "KV_REST_API_URL");
const UPSTASH_TOKEN = firstEnv("UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN");

function createUpstashStore(url: string, token: string): Store {
  async function cmd<T>(...args: (string | number)[]): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args.map(String)),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`upstash ${args[0]} failed: ${res.status}`);
    }
    const json = (await res.json()) as { result: T };
    return json.result;
  }

  return {
    durable: true,
    async get(key) {
      return cmd<string | null>("GET", key);
    },
    async set(key, value, ttlSec) {
      await cmd("SET", key, value, "EX", ttlSec);
    },
    async incr(key, by = 1) {
      return cmd<number>("INCRBY", key, by);
    },
    async ttl(key) {
      return cmd<number>("TTL", key);
    },
    async rpush(key, value) {
      await cmd("RPUSH", key, value);
    },
    async lrange(key, start, stop) {
      return (await cmd<string[] | null>("LRANGE", key, start, stop)) ?? [];
    },
    async ltrim(key, start, stop) {
      await cmd("LTRIM", key, start, stop);
    },
    async expire(key, ttlSec) {
      await cmd("EXPIRE", key, ttlSec);
    },
  };
}

interface MemoryEntry {
  value: string | string[];
  expiresAt: number;
}

const MEMORY_MAP_KEY = "__lunchMemoryStore__";

type GlobalWithStore = typeof globalThis & {
  [MEMORY_MAP_KEY]?: Map<string, MemoryEntry>;
};

/**
 * Next는 라우트마다 모듈을 따로 번들하므로, 모듈 스코프에 Map을 두면
 * `/api/group`이 쓴 값을 `/api/group/[code]`가 보지 못합니다.
 * 같은 프로세스 안에서라도 공유되도록 globalThis에 매답니다.
 * (HMR로 모듈이 다시 평가돼도 데이터가 유지되는 부수효과도 있습니다)
 */
function memoryMap(): Map<string, MemoryEntry> {
  const g = globalThis as GlobalWithStore;
  g[MEMORY_MAP_KEY] ??= new Map<string, MemoryEntry>();
  return g[MEMORY_MAP_KEY];
}

function createMemoryStore(): Store {
  const map = memoryMap();

  function live(key: string): MemoryEntry | undefined {
    const entry = map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      map.delete(key);
      return undefined;
    }
    return entry;
  }

  return {
    durable: false,
    async get(key) {
      const entry = live(key);
      if (!entry || Array.isArray(entry.value)) return null;
      return entry.value;
    },
    async set(key, value, ttlSec) {
      map.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
    },
    async incr(key, by = 1) {
      const entry = live(key);
      const current =
        entry && !Array.isArray(entry.value) ? Number(entry.value) || 0 : 0;
      const next = current + by;
      map.set(key, {
        value: String(next),
        // 호출자가 곧 expire()로 정확한 만료를 걸지만, 실패해도 새지 않게 상한을 둡니다
        expiresAt: entry?.expiresAt ?? Date.now() + 3_600_000,
      });
      return next;
    },
    async ttl(key) {
      const entry = live(key);
      if (!entry) return -2;
      if (!Number.isFinite(entry.expiresAt)) return -1;
      return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
    },
    async rpush(key, value) {
      const entry = live(key);
      const list = entry && Array.isArray(entry.value) ? entry.value : [];
      list.push(value);
      map.set(key, {
        value: list,
        expiresAt: entry?.expiresAt ?? Date.now() + 12 * 3600 * 1000,
      });
    },
    async lrange(key, start, stop) {
      const entry = live(key);
      if (!entry || !Array.isArray(entry.value)) return [];
      const list = entry.value;
      const end = stop < 0 ? list.length + stop + 1 : stop + 1;
      return list.slice(start < 0 ? Math.max(0, list.length + start) : start, end);
    },
    async ltrim(key, start, stop) {
      const entry = live(key);
      if (!entry || !Array.isArray(entry.value)) return;
      const list = entry.value;
      const end = stop < 0 ? list.length + stop + 1 : stop + 1;
      entry.value = list.slice(
        start < 0 ? Math.max(0, list.length + start) : start,
        end,
      );
    },
    async expire(key, ttlSec) {
      const entry = live(key);
      if (entry) entry.expiresAt = Date.now() + ttlSec * 1000;
    },
  };
}

let cached: Store | undefined;

export function getStore(): Store {
  if (!cached) {
    cached =
      UPSTASH_URL && UPSTASH_TOKEN
        ? createUpstashStore(UPSTASH_URL, UPSTASH_TOKEN)
        : createMemoryStore();
  }
  return cached;
}

/**
 * 그룹 기능을 노출해도 되는지 — 내구성 있는 스토어가 있어야 합니다.
 *
 * `ALLOW_MEMORY_GROUP=1`은 **로컬 검증 전용 탈출구**입니다. 메모리 스토어는
 * 서버리스에서 인스턴스마다 값이 달라 그룹 동기화에 쓸 수 없으므로,
 * 프로덕션에서는 절대 켜지 마세요.
 */
export function groupPlayAvailable(): boolean {
  if (UPSTASH_URL && UPSTASH_TOKEN) return true;
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_MEMORY_GROUP === "1"
  );
}
