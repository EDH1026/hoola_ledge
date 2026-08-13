"use server";

import { revalidatePath } from "next/cache";
import { v4 as uuidv4 } from "uuid";
import { mutateDB, readDB } from "./storage";
import { DB, GameType, WritableSettlementType } from "./types";
import { requireAdmin } from "./admin";
import { activeGames } from "./games";
import { nowInSeoul, todayInSeoul } from "./time";

function nowIso() {
  return new Date().toISOString();
}

export async function getDBSnapshot(): Promise<DB> {
  return readDB();
}

// ---------- Participants ----------
// Participant-pool management is admin-only (see PRD 8.1) — the /participants
// page itself is gated in proxy.ts, but these actions guard independently
// since a server action can be invoked without going through that page.

export async function addParticipant(name: string) {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("이름을 입력해 주세요.");

  await mutateDB((db) => {
    db.participants.push({
      id: uuidv4(),
      name: trimmed,
      active: true,
      createdAt: nowIso(),
    });
  });

  revalidatePath("/participants");
  revalidatePath("/games/new");
  revalidatePath("/");
}

export async function renameParticipant(id: string, name: string) {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("이름을 입력해 주세요.");

  await mutateDB((db) => {
    const p = db.participants.find((p) => p.id === id);
    if (p) p.name = trimmed;
  });

  revalidatePath("/participants");
  revalidatePath("/");
}

export async function setParticipantActive(id: string, active: boolean) {
  await requireAdmin();
  await mutateDB((db) => {
    const p = db.participants.find((p) => p.id === id);
    if (p) p.active = active;
  });

  revalidatePath("/participants");
  revalidatePath("/games/new");
}

// ---------- Games ----------

export async function getPreviousAttendeeIds(): Promise<string[]> {
  const db = await readDB();
  const games = activeGames(db.games);
  if (games.length === 0) return [];
  const sorted = [...games].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return sorted[0].attendeeIds;
}

export async function createGame(input: {
  gameType: GameType;
  attendeeIds: string[];
  winnerId: string;
  loserId: string;
  points?: number;
  note?: string;
}) {
  if (input.attendeeIds.length < 2) {
    throw new Error("참가자는 2명 이상이어야 합니다.");
  }
  if (!input.attendeeIds.includes(input.winnerId)) {
    throw new Error("Win은 참가자 목록에 포함되어야 합니다.");
  }
  if (!input.attendeeIds.includes(input.loserId)) {
    throw new Error("Lose는 참가자 목록에 포함되어야 합니다.");
  }
  if (input.winnerId === input.loserId) {
    throw new Error("Win과 Lose는 같은 사람일 수 없습니다.");
  }
  const points = input.points ?? 1;
  if (!Number.isInteger(points) || points < 1) {
    throw new Error("점수는 1 이상의 정수여야 합니다.");
  }

  // Date/time are never taken from the client — the server's own clock at
  // record time is the source of truth (PRD 8.3), converted to Asia/Seoul
  // wall-clock since that's what every displayed date/time in this app means.
  const { date, time } = nowInSeoul();

  await mutateDB((db) => {
    db.games.push({
      id: uuidv4(),
      date,
      time,
      gameType: input.gameType,
      points,
      active: true,
      attendeeIds: input.attendeeIds,
      winnerId: input.winnerId,
      loserId: input.loserId,
      note: input.note?.trim() || undefined,
      createdAt: nowIso(),
    });
  });

  revalidatePath("/games");
  revalidatePath("/games/new");
  revalidatePath("/settlements");
  revalidatePath("/stats");
  revalidatePath("/");
}

/**
 * Soft delete: marks the game inactive rather than removing it, so it drops
 * out of balances/stats/lists (see activeGames() in games.ts) but the record
 * itself survives for the admin rollback screen (see executeRollback below).
 */
export async function deleteGame(id: string) {
  await mutateDB((db) => {
    const g = db.games.find((g) => g.id === id);
    if (g) g.active = false;
  });

  revalidatePath("/games");
  revalidatePath("/settlements");
  revalidatePath("/stats");
  revalidatePath("/");
}

// ---------- Settlements ----------

export async function recordSettlement(input: {
  fromId: string;
  toId: string;
  amount: number;
  type?: WritableSettlementType;
  note?: string;
}) {
  if (input.amount <= 0) throw new Error("금액은 0보다 커야 합니다.");
  if (input.fromId === input.toId) {
    throw new Error("같은 사람 사이에는 기록할 수 없습니다.");
  }

  await mutateDB((db) => {
    db.settlements.push({
      id: uuidv4(),
      type: input.type ?? "payment",
      fromId: input.fromId,
      toId: input.toId,
      amount: input.amount,
      date: todayInSeoul(),
      note: input.note?.trim() || undefined,
      createdAt: nowIso(),
    });
  });

  revalidatePath("/settlements");
  revalidatePath("/");
}

export async function deleteSettlement(id: string) {
  await mutateDB((db) => {
    db.settlements = db.settlements.filter((s) => s.id !== id);
  });

  revalidatePath("/settlements");
  revalidatePath("/");
}

// ---------- Legacy ledger adjustments (admin-only, see PRD 8.2) ----------

export async function addLedgerAdjustment(input: {
  fromId: string;
  toId: string;
  amount: number;
  note?: string;
  date?: string;
}) {
  await requireAdmin();
  if (input.amount <= 0) throw new Error("금액은 0보다 커야 합니다.");
  if (input.fromId === input.toId) {
    throw new Error("같은 사람 사이에는 기록할 수 없습니다.");
  }

  await mutateDB((db) => {
    db.adjustments.push({
      id: uuidv4(),
      fromId: input.fromId,
      toId: input.toId,
      amount: input.amount,
      note: input.note?.trim() || undefined,
      date: input.date || todayInSeoul(),
      createdAt: nowIso(),
    });
  });

  revalidatePath("/adjustments");
  revalidatePath("/settlements");
  revalidatePath("/");
}

export async function updateLedgerAdjustment(
  id: string,
  input: {
    fromId: string;
    toId: string;
    amount: number;
    note?: string;
    date?: string;
  }
) {
  await requireAdmin();
  if (input.amount <= 0) throw new Error("금액은 0보다 커야 합니다.");
  if (input.fromId === input.toId) {
    throw new Error("같은 사람 사이에는 기록할 수 없습니다.");
  }

  await mutateDB((db) => {
    const a = db.adjustments.find((a) => a.id === id);
    if (a) {
      a.fromId = input.fromId;
      a.toId = input.toId;
      a.amount = input.amount;
      a.note = input.note?.trim() || undefined;
      a.date = input.date || a.date;
    }
  });

  revalidatePath("/adjustments");
  revalidatePath("/settlements");
  revalidatePath("/");
}

export async function deleteLedgerAdjustment(id: string) {
  await requireAdmin();
  await mutateDB((db) => {
    db.adjustments = db.adjustments.filter((a) => a.id !== id);
  });

  revalidatePath("/adjustments");
  revalidatePath("/settlements");
  revalidatePath("/");
}

// ---------- Admin data rollback (see PRD 8.8) ----------
// Hard-deletes games/settlements/adjustments created at or after a given
// instant. Deliberately operates on the RAW collections (not activeGames()-
// filtered) — a soft-deleted game created after the threshold must still be
// counted and actually removed, not silently skipped because it's already
// hidden from normal views. Participants are excluded by design (not a
// time-based event stream).

export interface RollbackCounts {
  games: number;
  settlements: number;
  adjustments: number;
}

export async function previewRollback(thresholdIso: string): Promise<RollbackCounts> {
  await requireAdmin();
  const db = await readDB();
  return {
    games: db.games.filter((g) => g.createdAt > thresholdIso).length,
    settlements: db.settlements.filter((s) => s.createdAt > thresholdIso).length,
    adjustments: db.adjustments.filter((a) => a.createdAt > thresholdIso).length,
  };
}

export async function executeRollback(thresholdIso: string): Promise<RollbackCounts> {
  await requireAdmin();
  const counts: RollbackCounts = { games: 0, settlements: 0, adjustments: 0 };

  await mutateDB((db) => {
    const keepGames = db.games.filter((g) => g.createdAt <= thresholdIso);
    counts.games = db.games.length - keepGames.length;
    db.games = keepGames;

    const keepSettlements = db.settlements.filter((s) => s.createdAt <= thresholdIso);
    counts.settlements = db.settlements.length - keepSettlements.length;
    db.settlements = keepSettlements;

    const keepAdjustments = db.adjustments.filter((a) => a.createdAt <= thresholdIso);
    counts.adjustments = db.adjustments.length - keepAdjustments.length;
    db.adjustments = keepAdjustments;
  });

  revalidatePath("/games");
  revalidatePath("/settlements");
  revalidatePath("/adjustments");
  revalidatePath("/stats");
  revalidatePath("/rollback");
  revalidatePath("/");

  return counts;
}
