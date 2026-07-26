"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 끌어서 높이를 바꾸는 바텀시트.
 *
 * 손잡이는 바텀시트의 만국공통 신호입니다. 그려놓고 동작이 없으면 사용자는
 * "내려가지 않는다"고 느낍니다 — 실제로 끌리게 만듭니다.
 *
 * 데스크톱(≥940px)에서는 패널이 전체 높이를 쓰므로 아무 것도 하지 않습니다.
 */

/**
 * 화면 높이에 대한 비율. 세 단계입니다.
 *   0 접음  — 손잡이만. 지도를 거의 전체로 씁니다
 *   1 기본  — 주요 컨트롤이 보입니다
 *   2 펼침  — 그룹·피드백까지 봅니다
 */
const SNAPS = [0.1, 0.44, 0.76] as const;
export const SNAP_PEEK = 0;
export const SNAP_DEFAULT = 1;
export const SNAP_FULL = 2;

/** 끌 수 있는 범위 */
const MIN_RATIO = 0.08;
const MAX_RATIO = 0.82;
/** 이보다 적게 움직였으면 탭으로 봅니다 */
const TAP_SLOP_PX = 6;
const DESKTOP_QUERY = "(min-width: 940px)";

const LABELS = ["접힘", "보통", "펼침"] as const;

export interface BottomSheet {
  panelRef: React.RefObject<HTMLElement | null>;
  snap: number;
  handleProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    "aria-label": string;
  };
  /** 최소 이 단계까지는 올립니다. 결과 카드가 접힌 시트에 가려지지 않게 */
  raiseAtLeast: (index: number) => void;
}

function nearestSnap(ratio: number): number {
  let best = 0;
  let bestGap = Infinity;
  SNAPS.forEach((s, i) => {
    const gap = Math.abs(s - ratio);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  });
  return best;
}

export function useBottomSheet(): BottomSheet {
  const panelRef = useRef<HTMLElement | null>(null);
  const [snap, setSnap] = useState<number>(SNAP_DEFAULT);
  const dragRef = useRef<{ startY: number; startH: number; moved: number } | null>(
    null,
  );

  /**
   * 포인터 핸들러가 최신 값을 읽되, setState 업데이터 안에서 부수효과를 부르지
   * 않도록 ref로 미러링합니다 — StrictMode에서 업데이터는 두 번 실행됩니다.
   */
  const snapRef = useRef(snap);
  useEffect(() => {
    snapRef.current = snap;
  }, [snap]);

  const isDesktop = useCallback(
    () => typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches,
    [],
  );

  /** dvh로 두면 화면 회전에도 비율이 유지됩니다 */
  const settle = useCallback((index: number) => {
    const el = panelRef.current;
    if (!el) return;
    el.style.transition = "height 220ms cubic-bezier(0.2, 0.9, 0.3, 1)";
    el.style.height = `${(SNAPS[index] ?? SNAPS[SNAP_DEFAULT]) * 100}dvh`;
  }, []);

  useEffect(() => {
    if (isDesktop()) return;
    settle(snap);
  }, [snap, settle, isDesktop]);

  const raiseAtLeast = useCallback((index: number) => {
    setSnap((current) => (current < index ? index : current));
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = panelRef.current;
      if (!el || isDesktop()) return;

      e.preventDefault();
      dragRef.current = {
        startY: e.clientY,
        startH: el.getBoundingClientRect().height,
        moved: 0,
      };
      el.style.transition = "none";
      (e.currentTarget as Element).setPointerCapture(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const dy = ev.clientY - drag.startY;
        drag.moved = Math.max(drag.moved, Math.abs(dy));
        // 아래로 끌면(dy > 0) 시트가 낮아집니다
        const next = drag.startH - dy;
        const min = window.innerHeight * MIN_RATIO;
        const max = window.innerHeight * MAX_RATIO;
        el.style.height = `${Math.min(max, Math.max(min, next))}px`;
      };

      const onUp = () => {
        const drag = dragRef.current;
        dragRef.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        if (!drag) return;

        // 거의 안 움직였으면 탭 — 세 단계를 순환합니다
        if (drag.moved < TAP_SLOP_PX) {
          const next = (snapRef.current + 1) % SNAPS.length;
          setSnap(next);
          settle(next);
          return;
        }

        const ratio = el.getBoundingClientRect().height / window.innerHeight;
        const next = nearestSnap(ratio);
        setSnap(next);
        settle(next);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [isDesktop, settle],
  );

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    // 키보드는 순환하지 않고 한 단계씩 — 예측 가능해야 합니다
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSnap((v) => Math.min(SNAPS.length - 1, v + 1));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSnap((v) => Math.max(0, v - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSnap((v) => (v + 1) % SNAPS.length);
    }
  }, []);

  return {
    panelRef,
    snap,
    handleProps: {
      onPointerDown,
      onKeyDown,
      "aria-label": `시트 높이 (현재 ${LABELS[snap] ?? "보통"}) — 끌거나 눌러서 조절`,
    },
    raiseAtLeast,
  };
}
