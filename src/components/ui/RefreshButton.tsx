"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";

/**
 * v2.21 (PRD §28.3) — replaces v2.20's GameNightRefresher (30s polling +
 * visibility detection) with an explicit manual refresh: the live board is
 * no longer "always fresh," it's fresh as of the last time someone tapped
 * this. `router.refresh()` re-runs the server component tree (the dashboard
 * is already `force-dynamic`), so no client-side data of its own is needed
 * here — just the pending state.
 *
 * `updatedAtLabel` is passed in already formatted by the server rather than
 * computed here with `new Date()`: this app always displays Asia/Seoul
 * wall-clock time regardless of the viewer's browser timezone, and a
 * client-formatted timestamp would also cause a hydration mismatch against
 * the server-rendered markup.
 */
export function RefreshButton({ updatedAtLabel }: { updatedAtLabel: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-xs text-content-muted whitespace-nowrap">{updatedAtLabel} 기준</span>
      <button
        type="button"
        disabled={isPending}
        onClick={() => startTransition(() => router.refresh())}
        className="min-h-11 min-w-11 inline-flex items-center justify-center gap-1 px-2 rounded-lg text-xs font-medium text-content-sub hover:bg-slate-700 hover:text-content transition disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <RotateCw className={`w-4 h-4 ${isPending ? "animate-spin" : ""}`} aria-hidden />
        갱신
      </button>
    </span>
  );
}
