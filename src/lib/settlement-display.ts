// v2.19 (배치 C, PRD §24.13) — pure presentation decisions for a net balance
// amount, split out of settlements/page.tsx so scripts/verify-settle.ts can
// assert the zero-balance case directly instead of only checking the raw
// number. Deliberately NOT in settle.ts (그 파일은 이번 배치에서도 안
// 건드리는 도메인 로직) — this is display mapping, not balance math.
export type BalanceVariant = "positive" | "negative" | "even";

export function balanceVariant(amount: number): BalanceVariant {
  if (amount > 0) return "positive";
  if (amount < 0) return "negative";
  return "even";
}

export function formatBalance(amount: number): string {
  if (amount > 0) return `+${amount}점`;
  if (amount < 0) return `${amount}점`;
  return "정산 완료";
}
