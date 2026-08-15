import type { ButtonHTMLAttributes } from "react";

interface FilterChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

// Exported so a non-<button> filter control (e.g. a server-driven <Link
// href="?filter=..."> that can't be a client FilterChip) can reuse the exact
// same visual language instead of a hand-copied class string.
export function filterChipClassName(selected = false, className = ""): string {
  return `inline-flex items-center min-h-9 rounded-lg px-3 text-xs font-medium transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50 disabled:pointer-events-none ${
    selected
      ? "bg-slate-700 text-content ring-1 ring-slate-500"
      : "bg-slate-800 text-content-sub hover:bg-slate-700"
  } ${className}`;
}

// Stays at 36px (not the 44px primary/destructive floor) — dense filter
// bars at 44px would eat half the screen. gap-2 (8px) between chips.
export function FilterChip({
  selected = false,
  className = "",
  ...props
}: FilterChipProps) {
  return (
    <button
      type="button"
      {...props}
      className={filterChipClassName(selected, className)}
    />
  );
}
