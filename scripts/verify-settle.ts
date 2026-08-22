// Quick standalone sanity check for the debt-simplification algorithm.
// Run with: npx tsx scripts/verify-settle.ts
import { simplifyDebts, computeNetBalances, computePeakBalances } from "../src/lib/settle";
import { computeDailySequenceNumbers } from "../src/lib/games";
import { computeParticipantStats, computeHeadToHead } from "../src/lib/stats";
import { GameResult, Settlement, LedgerAdjustment } from "../src/lib/types";
import { balanceVariant, formatBalance } from "../src/lib/settlement-display";

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

// Case 5: a PAYMENT (not a donation — see case 6) can fully cancel out an
// adjustment, since payment uses the same "repay a debt" formula as before.
{
  const adjustments: LedgerAdjustment[] = [
    { id: "adj1", fromId: "B", toId: "A", amount: 3, date: "2026-01-01", createdAt: "" },
  ];
  const settlements: Settlement[] = [
    { id: "s1", type: "payment", fromId: "B", toId: "A", amount: 3, date: "2026-01-02", createdAt: "" },
  ];
  const balances = computeNetBalances([], settlements, adjustments);
  assert(!balances.has("A") && !balances.has("B"), `case5: both should net to 0, got ${JSON.stringify([...balances])}`);
}

// Case 6 (v2.10 direction fix): "payment" and "donation" of the identical
// amount/pair now have OPPOSITE balance effects, and "waiver" (legacy name)
// matches "donation", not "payment". Before this fix all three were treated
// identically, which was the bug — a donation must move a giver's own points
// to someone else (same direction as Lose -> Win in a game), not repay a debt.
{
  const paid = computeNetBalances([], [
    { id: "s1", type: "payment", fromId: "A", toId: "B", amount: 5, date: "2026-01-01", createdAt: "" },
  ]);
  const donated = computeNetBalances([], [
    { id: "s2", type: "donation", fromId: "A", toId: "B", amount: 5, date: "2026-01-01", createdAt: "" },
  ]);
  const waived = computeNetBalances([], [
    { id: "s3", type: "waiver", fromId: "A", toId: "B", amount: 5, date: "2026-01-01", createdAt: "" },
  ]);
  assert(paid.get("A") === 5 && paid.get("B") === -5, `case6: payment should be A+5/B-5, got A=${paid.get("A")} B=${paid.get("B")}`);
  assert(donated.get("A") === -5 && donated.get("B") === 5, `case6: donation should be A-5/B+5 (opposite of payment), got A=${donated.get("A")} B=${donated.get("B")}`);
  assert(waived.get("A") === donated.get("A") && waived.get("B") === donated.get("B"), `case6: legacy waiver must match donation's direction, got waived=${JSON.stringify([...waived])} donated=${JSON.stringify([...donated])}`);
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

// Case 8: points-weighted game — a 2-point win moves ±2, not ±1, and
// computeParticipantStats' netPoints reflects the same weighting.
{
  const games: GameResult[] = [
    { id: "1", date: "2026-01-01", attendeeIds: ["A", "B"], winnerId: "A", loserId: "B", points: 2, createdAt: "" },
  ];
  const balances = computeNetBalances(games, []);
  assert(balances.get("A") === 2, `case8: A should be +2, got ${balances.get("A")}`);
  assert(balances.get("B") === -2, `case8: B should be -2, got ${balances.get("B")}`);

  const stats = computeParticipantStats(
    [
      { id: "A", name: "A", active: true },
      { id: "B", name: "B", active: true },
    ],
    games
  );
  const a = stats.find((s) => s.id === "A")!;
  const b = stats.find((s) => s.id === "B")!;
  assert(a.netPoints === 2, `case8: A netPoints should be 2, got ${a.netPoints}`);
  assert(b.netPoints === -2, `case8: B netPoints should be -2, got ${b.netPoints}`);
  assert(a.wins === 1 && b.losses === 1, "case8: win/loss counts still track games, not points");
}

// Case 9: a soft-deleted (active: false) game is excluded from both balances
// and stats, while a legacy record with no `active` field at all still counts.
{
  const games: GameResult[] = [
    { id: "1", date: "2026-01-01", attendeeIds: ["A", "B"], winnerId: "A", loserId: "B", active: false, createdAt: "" },
    { id: "2", date: "2026-01-02", attendeeIds: ["A", "B"], winnerId: "A", loserId: "B", createdAt: "" }, // no `active` field
  ];
  const balances = computeNetBalances(games, []);
  assert(balances.get("A") === 1, `case9: A should be +1 (only the legacy game counts), got ${balances.get("A")}`);

  const stats = computeParticipantStats(
    [
      { id: "A", name: "A", active: true },
      { id: "B", name: "B", active: true },
    ],
    games
  );
  const a = stats.find((s) => s.id === "A")!;
  assert(a.wins === 1, `case9: A should have 1 win (soft-deleted game excluded), got ${a.wins}`);
}

// Case 10: donating to the person you already owe makes your own balance
// WORSE, not better — proof that donation is not a repayment mechanism. A
// owes B 1 (from the game), then A donates 1 more to B: A's debt deepens.
{
  const games: GameResult[] = [
    { id: "1", date: "2026-01-01", attendeeIds: ["A", "B"], winnerId: "B", loserId: "A", createdAt: "" }, // A owes B 1
  ];
  const balances = computeNetBalances(games, [
    { id: "s1", type: "donation", fromId: "A", toId: "B", amount: 1, date: "2026-01-02", createdAt: "" },
  ]);
  assert(balances.get("A") === -2, `case10: A should be -2 (owed 1, then gave away 1 more), got ${balances.get("A")}`);
  assert(balances.get("B") === 2, `case10: B should be +2, got ${balances.get("B")}`);
}

// Case 11: concrete worked example for an arbitrary-pair donation, unrelated
// to any existing debt — Bob owes Carol 5 (adjustment), and Dave (who owes
// nothing) freely donates 3 of his own points to Bob. Dave's balance should
// drop by 3 (he gave value away) and Bob's should rise by 3 (he received it),
// same shape as the example shown to the user for confirmation.
{
  const adjustments: LedgerAdjustment[] = [
    { id: "adj1", fromId: "Bob", toId: "Carol", amount: 5, date: "2026-01-01", createdAt: "" },
  ];
  const settlements: Settlement[] = [
    { id: "s1", type: "donation", fromId: "Dave", toId: "Bob", amount: 3, date: "2026-01-02", createdAt: "" },
  ];
  const balances = computeNetBalances([], settlements, adjustments);
  assert(balances.get("Bob") === -2, `case11: Bob should be -2 (-5 owed, +3 donation received), got ${balances.get("Bob")}`);
  assert(balances.get("Carol") === 5, `case11: Carol should be +5 (unaffected by the donation), got ${balances.get("Carol")}`);
  assert(balances.get("Dave") === -3, `case11: Dave should be -3 (gave away 3 of his own points), got ${balances.get("Dave")}`);
}

// Case 12: head-to-head only attributes points to the actual winner/loser of
// each game, even with a 4-person attendee list — bystanders get no rows.
{
  const games: GameResult[] = [
    { id: "1", date: "2026-01-01", attendeeIds: ["A", "B", "C", "D"], winnerId: "A", loserId: "B", points: 2, createdAt: "" },
    { id: "2", date: "2026-01-02", attendeeIds: ["A", "B", "C", "D"], winnerId: "C", loserId: "A", createdAt: "" },
  ];
  const participants = ["A", "B", "C", "D"].map((id) => ({ id, name: id, active: true }));
  const h2h = computeHeadToHead(participants, games, "A");
  assert(h2h.length === 2, `case12: A should have exactly 2 opponents (B, C), got ${h2h.length}`);
  const vsB = h2h.find((e) => e.opponentId === "B");
  const vsC = h2h.find((e) => e.opponentId === "C");
  assert(!!vsB && vsB.pointsWon === 2 && vsB.pointsLost === 0, `case12: A vs B should be won=2/lost=0, got ${JSON.stringify(vsB)}`);
  assert(!!vsC && vsC.pointsWon === 0 && vsC.pointsLost === 1, `case12: A vs C should be won=0/lost=1, got ${JSON.stringify(vsC)}`);
  assert(!h2h.some((e) => e.opponentId === "D"), "case12: D (bystander in both games) should not appear at all");
}

// Case 13: multi-cluster minimality regression. Balances split into two
// independent zero-sum groups — {A:+7, B:-7} needs only 1 transaction, and
// {C:+6, D:+2, E:-8} needs only 2 — for a true minimum of 3. The old greedy
// "largest debtor vs largest creditor" heuristic tangled the two groups
// together (matching E against A first) and produced 4 instead.
{
  const balances = new Map<string, number>([
    ["A", 7],
    ["B", -7],
    ["C", 6],
    ["D", 2],
    ["E", -8],
  ]);
  const txs = simplifyDebts(balances);
  assert(txs.length === 3, `case13: expected 3 transactions (true minimum), got ${txs.length}`);

  const final = new Map(balances);
  for (const t of txs) {
    final.set(t.fromId, (final.get(t.fromId) ?? 0) + t.amount);
    final.set(t.toId, (final.get(t.toId) ?? 0) - t.amount);
  }
  assert(
    [...final.values()].every((v) => v === 0),
    `case13: applying all transactions should zero every balance, got ${JSON.stringify([...final])}`
  );
}

// Case 14: every transaction simplifyDebts returns must be "clean" — the
// amount never exceeds either party's own remaining balance at the time
// it's issued. This guards against the exact solver's search finding a
// mathematically-valid-but-confusing solution where someone is shown paying
// more than they owe (and getting partially repaid elsewhere).
{
  const balances = new Map<string, number>([
    ["유동", 17],
    ["상훈", 4],
    ["준환", -2],
    ["창민", -4],
    ["재훈", -4],
    ["재익", -5],
    ["미림", -6],
  ]);
  const txs = simplifyDebts(balances);
  const remaining = new Map(balances);
  let clean = true;
  for (const t of txs) {
    const fromBal = remaining.get(t.fromId) ?? 0;
    const toBal = remaining.get(t.toId) ?? 0;
    if (t.amount > -fromBal || t.amount > toBal) clean = false;
    remaining.set(t.fromId, fromBal + t.amount);
    remaining.set(t.toId, toBal - t.amount);
  }
  assert(clean, `case14: every transaction must be clean (no overpayment), got ${JSON.stringify(txs)}`);
  assert(
    [...remaining.values()].every((v) => v === 0),
    `case14: applying all transactions should zero every balance, got ${JSON.stringify([...remaining])}`
  );
}

// Case 15 (배치 C, PRD §24.13, 기능 수정): "잔액이 정확히 0인 참가자가
// 빨간색으로 표시된다" 버그의 회귀 테스트. computeNetBalances 자체는 이미
// 정확히 0인 항목을 맵에서 지운다("Clean up exact-zero entries for
// tidiness" — settle.ts 참고, 이번 배치에서 건드리지 않은 기존 동작)는
// 걸 A/B 두 참가자가 서로 정확히 상쇄되는 시나리오로 확인한다. 그 위에서
// settlements/page.tsx가 쓰는 색 결정 함수(balanceVariant/formatBalance,
// src/lib/settlement-display.ts)를 0/양수/음수 각각에 대해 직접 검증한다
// — 그 함수가 UI에서 실제로 쓰이는 값이므로, computeNetBalances가 0을
// 지우든 안 지우든 "0이 들어오면 빨강이 아니다"가 항상 성립해야 한다.
{
  const games: GameResult[] = [
    { id: "1", date: "2026-01-01", attendeeIds: ["A", "B"], winnerId: "A", loserId: "B", points: 3, createdAt: "" },
    { id: "2", date: "2026-01-02", attendeeIds: ["A", "B"], winnerId: "B", loserId: "A", points: 3, createdAt: "" },
  ];
  const balances = computeNetBalances(games, []);
  assert(
    !balances.has("A") && !balances.has("B"),
    `case15a: two participants whose games exactly offset should both be absent from the balance map (settle.ts already prunes exact-zero entries), got ${JSON.stringify([...balances])}`
  );
}
assert(balanceVariant(0) === "even", `case15b: balanceVariant(0) should be "even", got ${balanceVariant(0)}`);
assert(balanceVariant(5) === "positive", `case15b: balanceVariant(5) should be "positive", got ${balanceVariant(5)}`);
assert(balanceVariant(-5) === "negative", `case15b: balanceVariant(-5) should be "negative", got ${balanceVariant(-5)}`);
assert(
  formatBalance(0) === "이전 완료" && !formatBalance(0).includes("0"),
  `case15c: formatBalance(0) must not render as a bare "0" (the original bug's symptom), got "${formatBalance(0)}"`
);
assert(formatBalance(5) === "+5점", `case15c: formatBalance(5) should be "+5점", got "${formatBalance(5)}"`);
assert(formatBalance(-5) === "-5점", `case15c: formatBalance(-5) should be "-5점", got "${formatBalance(-5)}"`);

// Case 16 ("역대 최고 채권 보유"): a balance that once reached 20 and later
// settled back down to 19 must still record a peak of 20, not 19 — the
// whole point of computePeakBalances vs. computeNetBalances. The settlement
// is deliberately listed BEFORE the game in the input arrays to prove the
// function sorts by createdAt itself rather than trusting array order.
{
  const games: GameResult[] = [
    {
      id: "g1",
      date: "2026-03-01",
      attendeeIds: ["A", "B"],
      winnerId: "A",
      loserId: "B",
      points: 20,
      createdAt: "2026-03-01T10:00:00.000Z",
    },
  ];
  const settlements: Settlement[] = [
    {
      id: "s1",
      type: "payment",
      fromId: "B", // B is the debtor, paying A (the creditor) back
      toId: "A",
      amount: 1,
      date: "2026-03-02",
      createdAt: "2026-03-02T10:00:00.000Z",
    },
  ];
  const peaks = computePeakBalances(games, settlements, []);
  const finalBalances = computeNetBalances(games, settlements, []);

  assert(
    peaks.get("A")?.peak === 20,
    `case16: A's balance reached 20 before being partially paid down — peak should stay 20, got ${peaks.get("A")?.peak}`
  );
  assert(
    peaks.get("A")?.date === "2026-03-01",
    `case16: A's peak should be dated to the game that caused it (2026-03-01), got ${peaks.get("A")?.date}`
  );
  assert(
    finalBalances.get("A") === 19,
    `case16: A's CURRENT balance should be 19 (peak already settled down), got ${finalBalances.get("A")} — confirms peak and current are genuinely different numbers`
  );
  assert(
    !peaks.has("B"),
    `case16: B's balance was always negative (-20 then -19) and never positive — B should have no 채권 record at all, got ${JSON.stringify(peaks.get("B"))}`
  );
}

console.log("Done.");
