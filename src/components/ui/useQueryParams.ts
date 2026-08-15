"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

// v2.19 (배치 B, PRD §24.12) — small shared helper for syncing filter state
// to URL search params (used by StatsClient/RecordsClient; GamesListClient
// hand-rolls the same pattern itself since its year/month/day fields need
// cross-field validation — daysInMonth resets — that doesn't fit this
// generic shape). `set` always uses router.replace with `scroll: false` so
// changing a filter never yanks the page back to the top or adds a history
// entry per click.
export function useQueryParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function set(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return { searchParams, set };
}
