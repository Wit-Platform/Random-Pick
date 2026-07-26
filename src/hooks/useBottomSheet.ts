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

/** 화면 높이에 대한 비율 */
const SNAP_SMALL = 0.44;
const SNAP_LARGE = 0.76;
/** 끌 수 있는 범위. 지도가 완전히 사라지지 않게 상한을 둡니다 */
const MIN_RATIO = 0.24;
const MAX_RATIO = 0.8;
/** 이보다 적게 움직였으면 탭으로 봅니다 */
const TAP_SLOP_PX = 6;
const DESKTOP_QUERY = "(min-width: 940px)";

export interface BottomSheet {
  panelRef: React.RefObject<HTMLElement | null>;
  expanded: boolean;
  /** 손잡이에 그대로 펼쳐 넣습니다 */
  handleProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    "aria-expanded": boolean;
  };
  toggle: () => void;
}

export function useBottomSheet(): BottomSheet {
  const panelRef = useRef<HTMLElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const dragRef = useRef<{ startY: number; startH: number; moved: number } | null>(
    null,
  );
  /**
   * 포인터 핸들러가 최신 상태를 읽되, setState 업데이터 안에서 부수효과를 부르지
   * 않도록 ref로 미러링합니다. 업데이터 안에서 settle을 호출하면 StrictMode에서
   * 업데이터가 두 번 실행되며 높이 적용이 어긋나 두 번째 탭이 먹지 않았습니다.
   */
  const expandedRef = useRef(expanded);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  const isDesktop = useCallback(
    () => typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches,
    [],
  );

  /** 스냅 위치로 되돌립니다. dvh로 두면 화면 회전에도 비율이 유지됩니다 */
  const settle = useCallback((next: boolean) => {
    const el = panelRef.current;
    if (!el) return;
    el.style.transition = "height 220ms cubic-bezier(0.2, 0.9, 0.3, 1)";
    el.style.height = `${(next ? SNAP_LARGE : SNAP_SMALL) * 100}dvh`;
  }, []);

  useEffect(() => {
    if (isDesktop()) return;
    settle(expanded);
  }, [expanded, settle, isDesktop]);

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = panelRef.current;
      if (!el || isDesktop()) return;

      e.preventDefault();
      const startH = el.getBoundingClientRect().height;
      dragRef.current = { startY: e.clientY, startH, moved: 0 };
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

        // 거의 안 움직였으면 탭 — 두 상태를 오갑니다
        if (drag.moved < TAP_SLOP_PX) {
          const next = !expandedRef.current;
          setExpanded(next);
          settle(next);
          return;
        }

        // 가까운 스냅으로
        const ratio = el.getBoundingClientRect().height / window.innerHeight;
        const next = ratio > (SNAP_SMALL + SNAP_LARGE) / 2;
        setExpanded(next);
        settle(next);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [isDesktop, settle],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setExpanded(true);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setExpanded(false);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    },
    [toggle],
  );

  return {
    panelRef,
    expanded,
    handleProps: { onPointerDown, onKeyDown, "aria-expanded": expanded },
    toggle,
  };
}
