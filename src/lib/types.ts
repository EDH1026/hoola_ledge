export interface Participant {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
}

export type GameType = "hoola" | "citadels" | "6nimmt";

export const GAME_TYPE_LABELS: Record<GameType, string> = {
  hoola: "훌라",
  citadels: "시타델",
  "6nimmt": "젝스님트",
};

export const GAME_TYPES: GameType[] = ["hoola", "citadels", "6nimmt"];

export interface GameResult {
  id: string;
  date: string; // ISO date (yyyy-MM-dd), Asia/Seoul wall-clock, set server-side at record time — not user-editable
  time?: string; // "HH:mm", Asia/Seoul wall-clock, set server-side at record time. Absent on legacy records predating this field.
  gameType?: GameType; // absent on legacy records predating this field
  points?: number; // how many points the winner takes from the loser; absent on legacy records predating this field, treat as 1
  active?: boolean; // false = soft-deleted (excluded from balances/stats/lists but kept for admin rollback); absent/true = active
  attendeeIds: string[]; // participants who played this game
  winnerId: string; // 1st place ("Win" in UI)
  loserId: string; // last place ("Lose" in UI)
  note?: string;
  createdAt: string; // ISO datetime
}

// "waiver" is kept only so existing stored records keep parsing; new writes
// only ever use "payment" | "donation" (see actions.ts). Read sites must
// normalize "waiver" to "donation" before branching on type.
export type SettlementType = "payment" | "donation" | "waiver";
// The type new Settlement records are allowed to be written with.
export type WritableSettlementType = "payment" | "donation";

export interface Settlement {
  id: string;
  type?: SettlementType; // absent on legacy records predating this field; treat as "payment"
  fromId: string; // giver: debtor paying down what they owe, or anyone donating
  toId: string; // receiver: creditor being paid, or anyone receiving a donation
  amount: number;
  date: string; // ISO date
  note?: string;
  createdAt: string; // ISO datetime
}

/**
 * Pre-app debt/credit relationships entered by an admin, with no game behind
 * them (no win/lose, so these never feed participant stats). Opposite
 * direction from Settlement: fromId here is the debtor, not someone paying.
 */
export interface LedgerAdjustment {
  id: string;
  fromId: string; // debtor (owes)
  toId: string; // creditor (is owed)
  amount: number;
  note?: string;
  date: string; // ISO date
  createdAt: string; // ISO datetime
}

/** Canonicalizes a possibly-legacy SettlementType down to the two current values. */
export function normalizeSettlementType(
  type: SettlementType | undefined
): WritableSettlementType {
  if (type === "donation" || type === "waiver") return "donation";
  return "payment";
}

export interface DB {
  participants: Participant[];
  games: GameResult[];
  settlements: Settlement[];
  adjustments: LedgerAdjustment[];
}

export function emptyDB(): DB {
  return { participants: [], games: [], settlements: [], adjustments: [] };
}
