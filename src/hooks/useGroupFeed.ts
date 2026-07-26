"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FEED_POLL_MS } from "@/lib/config";
import type { GroupMember } from "@/lib/group";
import type { GroupThrowWithVotes, VoteValue } from "@/lib/types";

const VOTER_STORAGE_KEY = "lunch:voter";

/**
 * 투표자 식별자. 계정이 없어서 브라우저마다 임의 문자열을 하나 만들어 둡니다.
 * 이걸로 중복 투표를 막고 토글을 계산합니다. 개인을 식별하는 값은 아닙니다.
 */
function readVoterId(): string {
  try {
    const saved = window.localStorage.getItem(VOTER_STORAGE_KEY);
    if (saved && /^[A-Za-z0-9_-]{8,64}$/.test(saved)) return saved;
  } catch {
    // 저장이 막혀 있으면 이 세션에서만 쓰는 값을 만듭니다
  }
  const fresh =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 24)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  try {
    window.localStorage.setItem(VOTER_STORAGE_KEY, fresh);
  } catch {
    // 무시
  }
  return fresh;
}

export interface GroupFeed {
  throws: GroupThrowWithVotes[];
  members: GroupMember[];
  expired: boolean;
  refresh: () => void;
  vote: (entryId: string, value: VoteValue) => Promise<void>;
  remove: (entryId: string) => Promise<void>;
  /** 이 브라우저의 식별자. 방 잠그기 요청에 필요합니다 */
  voterId: string;
}

/**
 * 그룹 결과 피드를 폴링합니다.
 *
 * 탭이 백그라운드면 요청을 보내지 않습니다 — 점심 정하고 탭을 열어둔 사람 수만큼
 * 서버 요청이 쌓이는 걸 막기 위해서입니다. 탭이 다시 보이면 즉시 한 번 당겨옵니다.
 */
export function useGroupFeed(code: string | null, nick: string): GroupFeed {
  const [throws, setThrows] = useState<GroupThrowWithVotes[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [expired, setExpired] = useState(false);
  const [nonce, setNonce] = useState(0);

  /**
   * 닉네임은 ref로 읽습니다. 의존성에 넣으면 한 글자 칠 때마다 폴링이
   * 다시 시작됩니다.
   */
  const nickRef = useRef(nick);
  useEffect(() => {
    nickRef.current = nick;
  }, [nick]);

  const voterId = useMemo(
    () => (typeof window === "undefined" ? "" : readVoterId()),
    [],
  );

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  /** 서버 응답을 기다리지 않고 화면을 먼저 바꿉니다 — 투표는 즉각 반응해야 합니다 */
  const vote = useCallback(
    async (entryId: string, value: VoteValue) => {
      if (!code || !voterId) return;

      setThrows((current) =>
        current.map((entry) => {
          if (entry.id !== entryId) return entry;
          const wasSame = entry.myVote === value;
          const next = wasSame ? null : value;
          return {
            ...entry,
            myVote: next,
            up:
              entry.up +
              (next === "up" ? 1 : 0) -
              (entry.myVote === "up" ? 1 : 0),
            down:
              entry.down +
              (next === "down" ? 1 : 0) -
              (entry.myVote === "down" ? 1 : 0),
          };
        }),
      );

      try {
        const res = await fetch(`/api/group/${code}/votes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entryId, voterId, value }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as {
          up: number;
          down: number;
          myVote: VoteValue | null;
        };
        // 서버 값으로 맞춥니다 (다른 사람 표가 함께 반영됩니다)
        setThrows((current) =>
          current.map((entry) =>
            entry.id === entryId ? { ...entry, ...data } : entry,
          ),
        );
      } catch {
        // 실패하면 다음 폴링에서 서버 값으로 되돌아옵니다
        refresh();
      }
    },
    [code, voterId, refresh],
  );

  /** 본인이 올린 항목 삭제 */
  const remove = useCallback(
    async (entryId: string) => {
      if (!code || !voterId) return;
      setThrows((current) => current.filter((e) => e.id !== entryId));
      try {
        const res = await fetch(`/api/group/${code}/throws`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entryId, voterId }),
        });
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        // 실패하면 다음 폴링에서 되돌아옵니다
        refresh();
      }
    },
    [code, voterId, refresh],
  );

  useEffect(() => {
    if (!code) {
      setThrows([]);
      setMembers([]);
      setExpired(false);
      return;
    }

    let cancelled = false;
    let timer = 0;
    let inFlight: AbortController | null = null;

    const schedule = () => {
      if (!cancelled) timer = window.setTimeout(run, FEED_POLL_MS);
    };

    const run = async () => {
      if (document.visibilityState !== "visible") {
        schedule();
        return;
      }

      inFlight = new AbortController();
      try {
        const query = new URLSearchParams();
        if (voterId) query.set("voter", voterId);
        // 하트비트 — 이 요청 자체가 "지금 방에 있다"는 신호입니다
        const currentNick = nickRef.current.trim();
        if (currentNick) query.set("nick", currentNick);

        const res = await fetch(`/api/group/${code}/throws?${query}`, {
          signal: inFlight.signal,
        });
        if (cancelled) return;

        if (res.status === 404) {
          setExpired(true);
        } else if (res.ok) {
          const data = (await res.json()) as {
            throws: GroupThrowWithVotes[];
            members?: GroupMember[];
          };
          setThrows(data.throws);
          setMembers(data.members ?? []);
          setExpired(false);
        }
      } catch {
        // 폴링 실패는 다음 주기에 자연히 재시도됩니다
      }
      schedule();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        window.clearTimeout(timer);
        void run();
      }
    };

    void run();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      inFlight?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [code, nonce, voterId]);

  return { throws, members, expired, refresh, vote, remove, voterId };
}
