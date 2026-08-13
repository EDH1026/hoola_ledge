"use server";

import { revalidatePath } from "next/cache";
import {
  insertParticipant,
  updateParticipantName,
  updateParticipantActive,
  getMostRecentActiveAttendeeIds,
  insertGame,
  softDeleteGame,
  updateGameRow,
  insertSettlement,
  deleteSettlementRow,
  insertAdjustment,
  updateAdjustmentRow,
  deleteAdjustmentRow,
  countRollbackTargets,
  rollbackAfter,
  RollbackCounts,
} from "./storage";
import { GameType, WritableSettlementType } from "./types";
import { requireAdmin } from "./admin";
import { nowInSeoul, todayInSeoul } from "./time";

export type { RollbackCounts };

// ---------- Participants ----------
// Participant-pool management is admin-only (see PRD 8.1) — the /participants
// page itself is gated in proxy.ts, but these actions guard independently
// since a server action can be invoked without going through that page.

export async function addParticipant(name: string) {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("이름을 입력해 주세요.");

  await insertParticipant(trimmed);

  revalidatePath("/participants");
  revalidatePath("/games/new");
  revalidatePath("/");
}

export async function renameParticipant(id: string, name: string) {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("이름을 입력해 주세요.");

  await updateParticipantName(id, trimmed);

  revalidatePath("/participants");
  revalidatePath("/");
}

export async function setParticipantActive(id: string, active: boolean) {
  await requireAdmin();
  await updateParticipantActive(id, active);

  revalidatePath("/participants");
  revalidatePath("/games/new");
}

// ---------- Games ----------

export async function getPreviousAttendeeIds(): Promise<string[]> {
  return getMostRecentActiveAttendeeIds();
}

/** Shared by createGame and updateGame so the two entry points can never drift apart. Returns the normalized points value (defaulted to 1). */
function validateGameInput(input: {
  attendeeIds: string[];
  winnerId: string;
  loserId: string;
  points?: number;
}): number {
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
  return points;
}

export async function createGame(input: {
  gameType: GameType;
  attendeeIds: string[];
  winnerId: string;
  loserId: string;
  points?: number;
  note?: string;
}) {
  const points = validateGameInput(input);

  // Date/time are never taken from the client — the server's own clock at
  // record time is the source of truth (PRD 8.3), converted to Asia/Seoul
  // wall-clock since that's what every displayed date/time in this app means.
  const { date, time } = nowInSeoul();

  await insertGame({
    date,
    time,
    gameType: input.gameType,
    points,
    attendeeIds: input.attendeeIds,
    winnerId: input.winnerId,
    loserId: input.loserId,
    note: input.note?.trim() || undefined,
  });

  revalidatePath("/games");
  revalidatePath("/games/new");
  revalidatePath("/settlements");
  revalidatePath("/stats");
  revalidatePath("/");
}

/**
 * Admin-only correction of an existing game record (see PRD 11). Unlike
 * createGame, date/time ARE taken from the caller as-is — this is the one
 * deliberate exception to the "server clock is the source of truth" rule,
 * because the whole point is to let an admin fix a record without losing its
 * originally recorded moment the way delete-and-recreate would (recreate
 * always re-stamps the current instant via nowInSeoul()). `active` is also
 * writable here so a soft-deleted game can be viewed and reactivated.
 */
export async function updateGame(
  id: string,
  input: {
    date: string;
    time: string;
    gameType: GameType;
    attendeeIds: string[];
    winnerId: string;
    loserId: string;
    points?: number;
    note?: string;
    active: boolean;
  }
) {
  await requireAdmin();
  const points = validateGameInput(input);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw new Error("날짜 형식이 올바르지 않습니다.");
  }
  if (!/^\d{2}:\d{2}$/.test(input.time)) {
    throw new Error("시간 형식이 올바르지 않습니다.");
  }

  await updateGameRow(id, {
    date: input.date,
    time: input.time,
    gameType: input.gameType,
    points,
    active: input.active,
    attendeeIds: input.attendeeIds,
    winnerId: input.winnerId,
    loserId: input.loserId,
    note: input.note?.trim() || undefined,
  });

  // Same set as createGame, plus /games/new: editing attendees or flipping
  // `active` on the most recent game can change getPreviousAttendeeIds()'s
  // result, which seeds that form's default attendee selection.
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
  await softDeleteGame(id);

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
}): Promise<{ id: string }> {
  if (input.amount <= 0) throw new Error("금액은 0보다 커야 합니다.");
  if (input.fromId === input.toId) {
    throw new Error("같은 사람 사이에는 기록할 수 없습니다.");
  }

  const settlement = await insertSettlement({
    fromId: input.fromId,
    toId: input.toId,
    amount: input.amount,
    type: input.type ?? "payment",
    date: todayInSeoul(),
    note: input.note?.trim() || undefined,
  });

  revalidatePath("/settlements");
  revalidatePath("/");

  // Returned so the client can offer an immediate "just recorded · undo"
  // affordance right after the confirm step (PRD 9.1.4) without needing a
  // separate lookup.
  return { id: settlement.id };
}

export async function deleteSettlement(id: string) {
  await deleteSettlementRow(id);

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

  await insertAdjustment({
    fromId: input.fromId,
    toId: input.toId,
    amount: input.amount,
    note: input.note?.trim() || undefined,
    date: input.date || todayInSeoul(),
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

  await updateAdjustmentRow(id, {
    fromId: input.fromId,
    toId: input.toId,
    amount: input.amount,
    note: input.note?.trim() || undefined,
    date: input.date || todayInSeoul(),
  });

  revalidatePath("/adjustments");
  revalidatePath("/settlements");
  revalidatePath("/");
}

export async function deleteLedgerAdjustment(id: string) {
  await requireAdmin();
  await deleteAdjustmentRow(id);

  revalidatePath("/adjustments");
  revalidatePath("/settlements");
  revalidatePath("/");
}

// ---------- Admin data rollback (see PRD 8.8, 10.4) ----------
// Hard-deletes games/settlements/adjustments created at or after a given
// instant. Deliberately operates on the RAW tables (not active-filtered) —
// a soft-deleted game created after the threshold must still be counted and
// actually removed, not silently skipped because it's already hidden from
// normal views. Participants are excluded by design (not a time-based event
// stream). The actual delete runs as one Postgres transaction via the
// rollback_after() RPC (supabase/schema.sql) so partial failure can't leave
// e.g. games deleted but settlements untouched.

export async function previewRollback(thresholdIso: string): Promise<RollbackCounts> {
  await requireAdmin();
  return countRollbackTargets(thresholdIso);
}

export async function executeRollback(thresholdIso: string): Promise<RollbackCounts> {
  await requireAdmin();
  const counts = await rollbackAfter(thresholdIso);

  revalidatePath("/games");
  revalidatePath("/settlements");
  revalidatePath("/adjustments");
  revalidatePath("/stats");
  revalidatePath("/rollback");
  revalidatePath("/");

  return counts;
}
