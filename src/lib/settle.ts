import { GameResult, LedgerAdjustment, Settlement, normalizeSettlementType } from "./types";
import { activeGames } from "./games";

interface BalanceEvent {
  createdAt: string;
  date: string;
  deltas: readonly [string, number][];
}

/**
 * One entry per game/settlement/adjustment, each carrying the balance deltas
 * it causes. Shared by computeNetBalances (order doesn't matter, just sums
 * every delta) and computePeakBalances (order matters — it replays these in
 * the sequence they actually happened) so the sign conventions below live in
 * exactly one place instead of being duplicated and risking drift.
 */
function buildBalanceEvents(
  games: GameResult[],
  settlements: Settlement[],
  adjustments: LedgerAdjustment[]
): BalanceEvent[] {
  const events: BalanceEvent[] = [];

  for (const g of activeGames(games)) {
    const points = g.points ?? 1; // legacy games predate the points field
    events.push({
      createdAt: g.createdAt,
      date: g.date,
      // winner is owed `points` by the loser
      deltas: [[g.winnerId, points], [g.loserId, -points]],
    });
  }

  for (const s of settlements) {
    // Donation moves value the same direction as a game does (Lose -> Win):
    // the giver's balance goes DOWN and the receiver's balance goes UP. This
    // is not debt-repayment — it's the giver freely handing their own points
    // to someone else, uncapped and not tied to any computed debt.
    //
    // "payment": fromId (debtor) balance += amount, toId (creditor) balance
    // -= amount — paying down a real computed debt so both sides move
    // toward 0.
    const deltas: readonly [string, number][] =
      normalizeSettlementType(s.type) === "donation"
        ? [[s.fromId, -s.amount], [s.toId, s.amount]]
        : [[s.fromId, s.amount], [s.toId, -s.amount]];
    events.push({ createdAt: s.createdAt, date: s.date, deltas });
  }

  for (const a of adjustments) {
    // Opposite direction from Settlement: fromId is the debtor here, so
    // recording the adjustment makes them owe more (balance moves negative)
    // and makes toId owed more (balance moves positive).
    events.push({
      createdAt: a.createdAt,
      date: a.date,
      deltas: [[a.fromId, -a.amount], [a.toId, a.amount]],
    });
  }

  return events;
}

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
  for (const evt of buildBalanceEvents(games, settlements, adjustments)) {
    for (const [id, delta] of evt.deltas) {
      balances.set(id, (balances.get(id) ?? 0) + delta);
    }
  }

  // Clean up exact-zero entries for tidiness.
  for (const [id, bal] of balances) {
    if (bal === 0) balances.delete(id);
  }

  return balances;
}

export interface PeakBalanceEntry {
  peak: number; // the highest positive balance this participant ever held
  date: string; // the date that peak was reached on
}

/**
 * The highest positive balance ("채권", points owed TO them) each
 * participant ever held at any point in time — not their current balance.
 * A balance that climbed to 20 and later settled back down to 19 still
 * counts as a 20-point record; settling back down doesn't erase that it
 * happened. Replays every game/settlement/adjustment in the order they were
 * actually recorded (createdAt — the same chronological basis
 * computeRecords' win/loss streaks use in stats.ts), keeping a running
 * per-participant balance and remembering its high-water mark.
 *
 * Participants who never held a positive balance are omitted entirely
 * (there's no "record" to show), matching how computeRecords omits
 * participants with a zero-length streak.
 */
export function computePeakBalances(
  games: GameResult[],
  settlements: Settlement[],
  adjustments: LedgerAdjustment[] = []
): Map<string, PeakBalanceEntry> {
  const events = buildBalanceEvents(games, settlements, adjustments).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );

  const running = new Map<string, number>();
  const peaks = new Map<string, PeakBalanceEntry>();

  for (const evt of events) {
    for (const [id, delta] of evt.deltas) {
      const next = (running.get(id) ?? 0) + delta;
      running.set(id, next);
      const current = peaks.get(id);
      if (next > 0 && (!current || next > current.peak)) {
        peaks.set(id, { peak: next, date: evt.date });
      }
    }
  }

  return peaks;
}

export interface Transaction {
  fromId: string; // pays
  toId: string; // receives
  amount: number;
}

// Above this many nonzero balances, simplifyDebts falls back to the greedy
// heuristic instead of the exact search below. Branch-and-bound over N
// entries is fast for a single small social group (this app's whole
// premise), but its worst case grows combinatorially, so this threshold
// keeps the settlements page from ever hanging on an unusually large group.
const EXACT_SOLVE_THRESHOLD = 12;

/**
 * Reduce a set of net balances to the minimum number of pairwise transactions
 * needed to settle everyone up.
 *
 * For up to EXACT_SOLVE_THRESHOLD nonzero balances this finds the *true*
 * minimum via exhaustive branch-and-bound search (the "optimal account
 * balancing" problem). The simpler greedy largest-debtor-vs-largest-creditor
 * approach (still used as a fallback above the threshold) only guarantees at
 * most N-1 transactions — it is NOT always minimal, because it always merges
 * the single largest debtor with the single largest creditor even when the
 * balances actually split into independent zero-sum groups. Example:
 * A:+7, B:-7, C:+6, D:+2, E:-8 decomposes into {A,B} (1 transaction) and
 * {C,D,E} (2 transactions), a true minimum of 3 — but greedy produces 4 by
 * pairing E (largest debtor overall) with A (largest creditor overall)
 * first, tangling the two independent groups together. See
 * scripts/verify-settle.ts for this case.
 */
export function simplifyDebts(
  balances: Map<string, number>
): Transaction[] {
  const entries = Array.from(balances.entries()).filter(
    ([, amt]) => amt !== 0
  );
  if (entries.length === 0) return [];
  return entries.length > EXACT_SOLVE_THRESHOLD
    ? greedySimplify(entries)
    : exactSimplify(entries);
}

function greedySimplify(entries: [string, number][]): Transaction[] {
  const creditors: { id: string; amt: number }[] = [];
  const debtors: { id: string; amt: number }[] = [];

  for (const [id, bal] of entries) {
    if (bal > 0) creditors.push({ id, amt: bal });
    else debtors.push({ id, amt: -bal });
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

/**
 * Exhaustive branch-and-bound search for the true minimum transaction count
 * (equivalent to LeetCode 870, "Optimal Account Balancing"). At each step it
 * takes the first still-nonzero balance and tries paying/receiving against
 * every possible opposite-signed partner in turn — always as a "clean"
 * transaction capped at min(|amount owed|, |amount due|), the same style a
 * human would actually make, so nobody is ever shown paying more than they
 * owe (skipping duplicate amounts at the same depth, since trying an
 * identical value twice can never do better) — recursing until every
 * balance is zero, and keeping the shortest transaction sequence found
 * across all branches.
 */
function exactSimplify(entries: [string, number][]): Transaction[] {
  const ids = entries.map(([id]) => id);
  const amts = entries.map(([, amt]) => amt);

  let best: Transaction[] | null = null;
  const current: Transaction[] = [];

  function dfs(from: number) {
    let idx = from;
    while (idx < amts.length && amts[idx] === 0) idx++;
    if (idx === amts.length) {
      if (!best || current.length < best.length) best = [...current];
      return;
    }
    if (best && current.length + 1 >= best.length) return;

    const seen = new Set<number>();
    for (let j = idx + 1; j < amts.length; j++) {
      if (amts[j] === 0) continue;
      if (amts[idx] > 0 === amts[j] > 0) continue; // same sign never helps
      if (seen.has(amts[j])) continue;
      seen.add(amts[j]);

      const payerId = amts[idx] < 0 ? ids[idx] : ids[j];
      const receiverId = amts[idx] < 0 ? ids[j] : ids[idx];
      const amount = Math.min(Math.abs(amts[idx]), Math.abs(amts[j]));

      const savedIdx = amts[idx];
      const savedJ = amts[j];
      amts[idx] = amts[idx] < 0 ? amts[idx] + amount : amts[idx] - amount;
      amts[j] = amts[j] < 0 ? amts[j] + amount : amts[j] - amount;
      current.push({ fromId: payerId, toId: receiverId, amount });

      dfs(idx); // idx may still be nonzero (it was the larger side)

      current.pop();
      amts[idx] = savedIdx;
      amts[j] = savedJ;
    }
  }

  dfs(0);
  return best ?? [];
}

export function simplifiedSettlements(
  games: GameResult[],
  settlements: Settlement[],
  adjustments: LedgerAdjustment[] = []
): Transaction[] {
  return simplifyDebts(computeNetBalances(games, settlements, adjustments));
}
