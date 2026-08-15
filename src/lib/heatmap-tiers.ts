// v2.19 (배치 C, PRD §24.13) — head-to-head 매트릭스의 5단계 이산 히트맵
// 색. StatsClient.tsx(렌더링)와 scripts/verify-design-tokens.ts(대비 검증)가
// 같은 값을 봐야 하므로 별도 모듈로 뺐다 — 컴포넌트 파일("use client")을
// Node 스크립트에서 import하는 것도 기술적으로는 되지만, 이 값들은 React와
// 무관한 순수 데이터라 여기 두는 게 더 정직하다.
export type HeatTier = "strong-lose" | "lose" | "even" | "win" | "strong-win";

export const HEAT_TIER_COLORS: Record<HeatTier, string> = {
  "strong-lose": "#dc2626",
  lose: "#7f1d1d",
  even: "#334155",
  win: "#065f46",
  "strong-win": "#047857",
};

export const HEAT_TIER_LABELS: Record<HeatTier, string> = {
  "strong-lose": "강한 열세",
  lose: "열세",
  even: "호각",
  win: "우세",
  "strong-win": "강한 우세",
};

export const HEAT_TIER_ORDER: HeatTier[] = ["strong-lose", "lose", "even", "win", "strong-win"];

// t <= 0.15 (of the row's own max |net|) reads as "호각" regardless of sign
// — a razor-thin edge shouldn't paint as a strong color. Above that, 0.5 is
// the strong/mild split.
export function heatTier(net: number, maxAbs: number): HeatTier {
  if (maxAbs === 0) return "even";
  const t = Math.abs(net) / maxAbs;
  if (t <= 0.15) return "even";
  if (net > 0) return t > 0.5 ? "strong-win" : "win";
  return t > 0.5 ? "strong-lose" : "lose";
}
