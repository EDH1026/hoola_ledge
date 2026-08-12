export interface Participant {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
}

export interface GameResult {
  id: string;
  date: string; // ISO date (yyyy-MM-dd)
  attendeeIds: string[]; // participants who played this game
  winnerId: string; // 1st place
  loserId: string; // last place
  note?: string;
  createdAt: string; // ISO datetime
}

export interface Settlement {
  id: string;
  fromId: string; // debtor who paid
  toId: string; // creditor who received
  amount: number;
  date: string; // ISO date
  note?: string;
  createdAt: string; // ISO datetime
}

export interface DB {
  participants: Participant[];
  games: GameResult[];
  settlements: Settlement[];
}

export function emptyDB(): DB {
  return { participants: [], games: [], settlements: [] };
}
