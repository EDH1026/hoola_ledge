"use client";

import { useEffect } from "react";

/**
 * v2.20 (PRD §26.5) — keeps the screen on while /tonight is open (a phone
 * left face-up in the middle of the table). The Wake Lock API isn't
 * supported everywhere (most notably iOS Safari as of this writing), so
 * every call is wrapped in try/catch and failures are swallowed silently —
 * there's nothing useful to show the user, and this is a nice-to-have, not
 * something that should ever surface an error banner.
 *
 * A wake lock is automatically released by the browser when the tab is
 * hidden, so it's re-requested on `visibilitychange` back to "visible"
 * rather than only once on mount.
 */
export function WakeLockKeeper() {
  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null;

    async function requestLock() {
      try {
        sentinel = (await navigator.wakeLock?.request("screen")) ?? null;
      } catch {
        // Unsupported or refused (e.g. low battery) — silently ignore.
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        requestLock();
      }
    }

    requestLock();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      sentinel?.release().catch(() => {});
    };
  }, []);

  return null;
}
