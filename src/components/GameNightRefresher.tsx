"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 30_000;

/**
 * v2.20 (PRD §26.6) — polls `router.refresh()` every 30s while the board is
 * on screen, so a newly-recorded game shows up without a manual reload. The
 * dashboard/tonight pages are already `force-dynamic`, so a refresh
 * re-fetches and re-computes the board server-side; this component has no
 * data of its own.
 *
 * Only mount this next to a board that's actually showing (the caller
 * already knows `computeGameNightBoard` returned non-null) — when there's
 * no game night, nothing should be polling at all.
 *
 * No websocket/SSE: 8 people on a 30s poll is nothing, and the added
 * infrastructure isn't worth it (PRD §26.7).
 */
export function GameNightRefresher() {
  const router = useRouter();
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    function refresh() {
      router.refresh();
      setLastRefreshed(new Date());
    }

    function startPolling() {
      if (intervalRef.current) return; // already running
      intervalRef.current = setInterval(refresh, POLL_INTERVAL_MS);
    }

    function stopPolling() {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        refresh(); // 돌아오자마자 한 번 즉시 갱신
        startPolling();
      } else {
        stopPolling(); // 탭이 안 보이는 동안엔 네트워크 요청을 만들지 않는다
      }
    }

    if (document.visibilityState === "visible") {
      startPolling();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router]);

  if (!lastRefreshed) return null;

  return (
    <p className="text-xs text-content-muted mt-2 tabular-nums">
      마지막 갱신{" "}
      {lastRefreshed.toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        // 이 앱은 보는 사람의 브라우저 타임존과 무관하게 항상 Asia/Seoul
        // 벽시계를 보여준다(src/lib/time.ts 상단 주석 참고).
        timeZone: "Asia/Seoul",
      })}
    </p>
  );
}
