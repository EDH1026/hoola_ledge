// v2.19 (배치 C, PRD §24.13) — participant ID -> a fixed color, shared by
// every chart/성향 맵/기록실 that needs to color data by participant.
//
// Position-based assignment (the old `PALETTE[i % PALETTE.length]`, keyed to
// each dataset's own row order) meant the same person's line/dot color
// changed whenever a filter changed which participants appeared or in what
// order — no "I'm the green line" mental model could ever form. This module
// fixes each participant to one color for as long as the roster doesn't
// change, and every consumer must go through `buildParticipantColorMap` (not
// a per-id hash) so two screens can never disagree about the same person's
// color — a hash-per-id function and an index-based map are two independent
// sources of truth that *could* drift apart; only one of them exists here.
//
// Palette constraints (enforced by scripts/verify-design-tokens.ts):
//  - every color >= 3:1 contrast against --color-surface (#0f172a)
//  - nothing close to body text color (the old PALETTE[0] #e2e8f0 was
//    slate-200 — indistinguishable from UI text at a glance)
//  - no pure green/red — those already mean win/lose (--color-win /
//    --color-lose) on the same screens this palette appears on

export const PARTICIPANT_PALETTE = [
  "#38bdf8", // sky-400
  "#fbbf24", // amber-400
  "#e879f9", // fuchsia-400
  "#22d3ee", // cyan-400
  "#fb923c", // orange-400
  "#a78bfa", // violet-400
  "#f472b6", // pink-400
  "#2dd4bf", // teal-400
  "#60a5fa", // blue-400
] as const;

/**
 * Sorted-id -> palette index. Sorting first (rather than hashing each id in
 * isolation) means assignment doesn't depend on id string content, and with
 * a roster (~8 people) smaller than the palette (9 colors) every participant
 * gets a genuinely distinct color rather than risking a hash collision. The
 * roster barely changes, so re-deriving this on every render is cheap and
 * keeps colors stable without needing to persist an assignment anywhere.
 */
export function buildParticipantColorMap(
  participants: { id: string }[]
): Map<string, string> {
  const sortedIds = participants.map((p) => p.id).sort();
  const map = new Map<string, string>();
  sortedIds.forEach((id, i) => {
    map.set(id, PARTICIPANT_PALETTE[i % PARTICIPANT_PALETTE.length]);
  });
  return map;
}

/** Fallback for an id that isn't in the map (e.g. a soft-deleted participant no longer in the roster passed in) — content-faint-ish gray, never a palette color (so it can't coincidentally collide with someone else's fixed color). */
export const PARTICIPANT_COLOR_FALLBACK = "#94a3b8"; // slate-400
