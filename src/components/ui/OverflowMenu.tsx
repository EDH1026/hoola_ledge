"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

// v2.19 (배치 B, PRD §24.11) — replaces rows of 16px text-link actions
// (수정/삭제/완전삭제) with one 44×44 trigger. Built directly on
// click-outside/Escape rather than pulling in a headless menu library, since
// the interaction surface here is small (a handful of rows, one menu open at
// a time).
export function OverflowMenu({
  label = "더 보기",
  children,
}: {
  label?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="w-11 h-11 flex items-center justify-center rounded-lg text-content-sub hover:bg-slate-700 hover:text-content transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <MoreHorizontal className="w-[18px] h-[18px]" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 min-w-[160px] overflow-hidden rounded-lg border border-line bg-surface-raised shadow-lg py-1"
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
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
