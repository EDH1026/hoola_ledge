// Quick standalone sanity check for the debt-simplification algorithm.
// Run with: npx tsx scripts/verify-settle.ts
import { simplifyDebts, computeNetBalances } from "../src/lib/settle";
import { computeDailySequenceNumbers } from "../src/lib/games";
import { GameResult, Settlement, LedgerAdjustment } from "../src/lib/types";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("PASS:", msg);
  }
}

// Case 1: user's example — A owes B 2, B owes C 1
// => net: A=-2, B=+1, C=+1 => expect A pays B 1, A pays C 1 (2 transactions total, A pays out 2)
{
  const balances = new Map<string, number>([
    ["A", -2],
    ["B", 1],
    ["C", 1],
  ]);
  const txs = simplifyDebts(balances);
  const totalFromA = txs
    .filter((t) => t.fromId === "A")
    .reduce((s, t) => s + t.amount, 0);
  assert(txs.length === 2, `case1: expected 2 transactions, got ${txs.length}`);
  assert(totalFromA === 2, `case1: A should pay out 2 total, got ${totalFromA}`);
  assert(
    txs.every((t) => t.fromId === "A"),
    "case1: all payments should originate from A"
  );
}

// Case 2: simple game ledger -> balances -> simplify
{
  const games: GameResult[] = [
    { id: "1", date: "2026-01-01", attendeeIds: ["A", "B", "C"], winnerId: "B", loserId: "A", createdAt: "" },
    { id: "2", date: "2026-01-02", attendeeIds: ["A", "B", "C"], winnerId: "C", loserId: "B", createdAt: "" },
    { id: "3", date: "2026-01-03", attendeeIds: ["A", "B", "C"], winnerId: "C", loserId: "A", createdAt: "" },
  ];
  // A: loses twice (-2), B: wins once loses once (0), C: wins twice (+2)
  const balances = computeNetBalances(games, []);
  assert(balances.get("A") === -2, `case2: A balance should be -2, got ${balances.get("A")}`);
  assert(!balances.has("B"), `case2: B balance should net to 0 (removed), got ${balances.get("B")}`);
  assert(balances.get("C") === 2, `case2: C balance should be +2, got ${balances.get("C")}`);

  const txs = simplifyDebts(balances);
  assert(txs.length === 1, `case2: expected 1 transaction, got ${txs.length}`);
  assert(
    txs[0].fromId === "A" && txs[0].toId === "C" && txs[0].amount === 2,
    `case2: expected A->C 2, got ${JSON.stringify(txs[0])}`
  );
}

// Case 3: settlement partially pays down a debt
{
  const games: GameResult[] = [
    { id: "1", date: "2026-01-01", attendeeIds: ["A", "B"], winnerId: "B", loserId: "A", createdAt: "" },
    { id: "2", date: "2026-01-02", attendeeIds: ["A", "B"], winnerId: "B", loserId: "A", createdAt: "" },
  ];
  const settlements: Settlement[] = [
    { id: "s1", fromId: "A", toId: "B", amount: 1, date: "2026-01-03", createdAt: "" },
  ];
  const balances = computeNetBalances(games, settlements);
  assert(balances.get("A") === -1, `case3: A balance should be -1 after partial settle, got ${balances.get("A")}`);
  const txs = simplifyDebts(balances);
  assert(
    txs.length === 1 && txs[0].amount === 1,
    `case3: expected remaining 1 transaction of amount 1, got ${JSON.stringify(txs)}`
  );
}

// Case 4: legacy ledger adjustment alone — "B owes A 3" => A is owed 3, B owes 3
{
  const adjustments: LedgerAdjustment[] = [
    { id: "adj1", fromId: "B", toId: "A", amount: 3, date: "2026-01-01", createdAt: "" },
  ];
  const balances = computeNetBalances([], [], adjustments);
  assert(balances.get("B") === -3, `case4: B (debtor) should be -3, got ${balances.get("B")}`);
  assert(balances.get("A") === 3, `case4: A (creditor) should be +3, got ${balances.get("A")}`);
  const txs = simplifyDebts(balances);
  assert(
    txs.length === 1 && txs[0].fromId === "B" && txs[0].toId === "A" && txs[0].amount === 3,
    `case4: expected B->A 3, got ${JSON.stringify(txs)}`
  );
}

// Case 5: a settlement (of any type) can fully cancel out an adjustment —
// both should drop out of the balances map once net is zero.
{
  const adjustments: LedgerAdjustment[] = [
    { id: "adj1", fromId: "B", toId: "A", amount: 3, date: "2026-01-01", createdAt: "" },
  ];
  const settlements: Settlement[] = [
    { id: "s1", type: "waiver", fromId: "B", toId: "A", amount: 3, date: "2026-01-02", createdAt: "" },
  ];
  const balances = computeNetBalances([], settlements, adjustments);
  assert(!balances.has("A") && !balances.has("B"), `case5: both should net to 0, got ${JSON.stringify([...balances])}`);
}

// Case 6: a waiver has the exact same balance effect as an equal-amount payment
{
  const games: GameResult[] = [
    { id: "1", date: "2026-01-01", attendeeIds: ["A", "B"], winnerId: "B", loserId: "A", createdAt: "" },
  ];
  const paid = computeNetBalances(games, [
    { id: "s1", type: "payment", fromId: "A", toId: "B", amount: 1, date: "2026-01-02", createdAt: "" },
  ]);
  const waived = computeNetBalances(games, [
    { id: "s2", type: "waiver", fromId: "A", toId: "B", amount: 1, date: "2026-01-02", createdAt: "" },
  ]);
  assert(
    !paid.has("A") && !paid.has("B") && !waived.has("A") && !waived.has("B"),
    `case6: payment and waiver of the same amount should both net everyone to 0, got paid=${JSON.stringify([...paid])} waived=${JSON.stringify([...waived])}`
  );
}

// Case 7: N차전 numbering — grouped by date across all game types, ordered by
// time (legacy games with no `time` sort first, oldest-first via createdAt).
{
  const games: GameResult[] = [
    { id: "legacy1", date: "2026-01-01", attendeeIds: ["A", "B"], winnerId: "A", loserId: "B", createdAt: "2026-01-01T09:00:00.000Z" },
    { id: "timed2", date: "2026-01-01", time: "20:30", gameType: "citadels", attendeeIds: ["A", "B"], winnerId: "A", loserId: "B", createdAt: "2026-01-01T20:31:00.000Z" },
    { id: "timed1", date: "2026-01-01", time: "19:00", gameType: "hoola", attendeeIds: ["A", "B"], winnerId: "A", loserId: "B", createdAt: "2026-01-01T19:01:00.000Z" },
    { id: "otherday", date: "2026-01-02", time: "10:00", gameType: "6nimmt", attendeeIds: ["A", "B"], winnerId: "A", loserId: "B", createdAt: "2026-01-02T10:01:00.000Z" },
  ];
  const seq = computeDailySequenceNumbers(games);
  assert(seq.get("legacy1") === 1, `case7: legacy (no time) game should sort first, got ${seq.get("legacy1")}`);
  assert(seq.get("timed1") === 2, `case7: 19:00 game should be 2nd, got ${seq.get("timed1")}`);
  assert(seq.get("timed2") === 3, `case7: 20:30 game should be 3rd, got ${seq.get("timed2")}`);
  assert(seq.get("otherday") === 1, `case7: different date should restart numbering, got ${seq.get("otherday")}`);
}

console.log("Done.");
