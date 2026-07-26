"use client";

import { useCallback, useEffect, useState } from "react";

import { FEED_POLL_MS } from "@/lib/config";
import type { GroupThrow } from "@/lib/types";

export interface GroupFeed {
  throws: GroupThrow[];
  expired: boolean;
  refresh: () => void;
}

/**
 * 그룹 결과 피드를 폴링합니다.
 *
 * 탭이 백그라운드면 요청을 보내지 않습니다 — 점심 결정하고 탭을 열어둔 사람 수만큼
 * 서버 요청이 계속 쌓이는 걸 막기 위해서입니다. 탭이 다시 보이면 즉시 한 번 당겨옵니다.
 */
export function useGroupFeed(code: string | null): GroupFeed {
  const [throws, setThrows] = useState<GroupThrow[]>([]);
  const [expired, setExpired] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!code) {
      setThrows([]);
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
        const res = await fetch(`/api/group/${code}/throws`, {
          signal: inFlight.signal,
        });
        if (cancelled) return;

        if (res.status === 404) {
          setExpired(true);
        } else if (res.ok) {
          const data = (await res.json()) as { throws: GroupThrow[] };
          setThrows(data.throws);
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
  }, [code, nonce]);

  return { throws, expired, refresh };
}
