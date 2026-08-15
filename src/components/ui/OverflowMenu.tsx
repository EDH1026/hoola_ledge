"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

// v2.19 (배치 B, PRD §24.11) — replaces rows of 16px text-link actions
// (수정/삭제/완전삭제) with one 44×44 trigger. Built directly on
// click-outside/Escape rather than pulling in a headless menu library, since
// the interaction surface here is small (a handful of rows, one menu open at
// a time).
//
// The dropdown panel is rendered into a portal on `document.body` rather
// than as a normal child. Trigger buttons live inside `overflow-hidden`
// cards (e.g. the /games list, clipped so its rounded corners crop the row
// list) — an in-flow `absolute` panel gets silently clipped by that
// ancestor whenever the panel would extend past the card's edge, which is
// most rows in a normal-length list. Portaling escapes that clipping
// entirely; position is computed from the trigger's own bounding box
// instead of relying on normal-flow `absolute` positioning.
export function OverflowMenu({
  label = "더 보기",
  children,
}: {
  label?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // The panel's position is computed once, at open time, from the
    // trigger's bounding box — cheaper than tracking continuously, and the
    // menu is short-lived enough (open, pick an item, close) that staying
    // perfectly glued to the trigger through a scroll isn't worth the
    // complexity. A scroll (page or any scrollable ancestor) just closes it
    // instead of leaving it floating in a stale spot.
    function onScroll() {
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const close = () => setOpen(false);

  function toggleOpen() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen((o) => !o);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="w-11 h-11 flex items-center justify-center rounded-lg text-content-sub hover:bg-slate-700 hover:text-content transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <MoreHorizontal className="w-[18px] h-[18px]" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", top: pos.top, right: pos.right }}
            className="z-50 min-w-[160px] overflow-hidden rounded-lg border border-line bg-surface-raised shadow-lg py-1"
          >
            {typeof children === "function" ? children(close) : children}
          </div>,
          document.body
        )}
    </>
  );
}

export function OverflowMenuItem({
  onClick,
  danger = false,
  disabled = false,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center w-full min-h-11 px-3 text-left text-sm transition hover:bg-slate-700 focus-visible:outline-none focus-visible:bg-slate-700 disabled:opacity-50 disabled:pointer-events-none ${
        danger ? "text-red-300" : "text-content-sub"
      }`}
    >
      {children}
    </button>
  );
}
