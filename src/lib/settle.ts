import { GameResult, LedgerAdjustment, Settlement, normalizeSettlementType } from "./types";
import { activeGames } from "./games";

/**
 * Net balance per participant.
 * Positive balance = this person is owed points (net creditor).
 * Negative balance = this person owes points (net debtor).
 *
 * Filters out soft-deleted (`active: false`) games internally, so every
 * caller gets correct balances without having to remember to filter first.
 */
export function computeNetBalances(
  games: GameResult[],
  settlements: Settlement[],
  adjustments: LedgerAdjustment[] = []
): Map<string, number> {
  const balances = new Map<string, number>();
  const add = (id: string, delta: number) => {
    balances.set(id, (balances.get(id) ?? 0) + delta);
  };

  for (const g of activeGames(games)) {
    const points = g.points ?? 1; // legacy games predate the points field
    add(g.winnerId, points); // winner is owed `points` by the loser
    add(g.loserId, -points);
  }

  for (const s of settlements) {
    if (normalizeSettlementType(s.type) === "donation") {
      // Donation moves value the same direction as a game does (Lose -> Win):
      // the giver's balance goes DOWN and the receiver's balance goes UP.
      // This is not debt-repayment — it's the giver freely handing their own
      // points to someone else, uncapped and not tied to any computed debt.
      add(s.fromId, -s.amount);
      add(s.toId, s.amount);
    } else {
      // "payment": fromId (debtor) balance += amount, toId (creditor)
      // balance -= amount — paying down a real computed debt so both sides
      // move toward 0.
      add(s.fromId, s.amount);
      add(s.toId, -s.amount);
    }
  }

  for (const a of adjustments) {
    // Opposite direction from Settlement: fromId is the debtor here, so
    // recording the adjustment makes them owe more (balance moves negative)
    // and makes toId owed more (balance moves positive).
    add(a.fromId, -a.amount);
    add(a.toId, a.amount);
  }

  // Clean up exact-zero entries for tidiness.
  for (const [id, bal] of balances) {
    if (bal === 0) balances.delete(id);
  }

  return balances;
}

export interface Transaction {
  fromId: string; // pays
  toId: string; // receives
  amount: number;
}

/**
 * Reduce a set of net balances to the minimum number of pairwise transactions
 * needed to settle everyone up, using the standard greedy
 * largest-debtor-vs-largest-creditor matching approach (same idea used by
 * apps like Splitwise). For N people with non-zero balances this produces at
 * most N-1 transactions.
 */
export function simplifyDebts(
  balances: Map<string, number>
): Transaction[] {
  const creditors: { id: string; amt: number }[] = [];
  const debtors: { id: string; amt: number }[] = [];

  for (const [id, bal] of balances) {
    if (bal > 0) creditors.push({ id, amt: bal });
    else if (bal < 0) debtors.push({ id, amt: -bal });
  }

  creditors.sort((a, b) => b.amt - a.amt);
  debtors.sort((a, b) => b.amt - a.amt);

  const txs: Transaction[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const amt = Math.min(d.amt, c.amt);

    if (amt > 0) {
      txs.push({ fromId: d.id, toId: c.id, amount: amt });
    }

    d.amt -= amt;
    c.amt -= amt;

    if (d.amt === 0) i++;
    if (c.amt === 0) j++;
  }

  return txs;
}

export function simplifiedSettlements(
  games: GameResult[],
  settlements: Settlement[],
  adjustments: LedgerAdjustment[] = []
): Transaction[] {
  return simplifyDebts(computeNetBalances(games, settlements, adjustments));
}
