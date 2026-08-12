// Quick standalone sanity check for the debt-simplification algorithm.
// Run with: npx tsx scripts/verify-settle.ts
import { simplifyDebts, computeNetBalances } from "../src/lib/settle";
import { GameResult, Settlement } from "../src/lib/types";

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

console.log("Done.");
