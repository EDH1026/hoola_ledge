"use server";

import { revalidatePath } from "next/cache";
import {
  insertParticipant,
  updateParticipantName,
  updateParticipantActive,
  getMostRecentActiveAttendeeIds,
  insertGame,
  softDeleteGame,
  restoreGame as restoreGameRow,
  deleteGameRow,
  updateGameRow,
  getGameById,
  insertSettlement,
  deleteSettlementRow,
  getSettlementById,
  insertAdjustment,
  updateAdjustmentRow,
  deleteAdjustmentRow,
  countRollbackTargets,
  rollbackAfter,
  RollbackCounts,
} from "./storage";
import { GameType, WritableSettlementType } from "./types";
import { requireAdmin, isAdminSession } from "./admin";
import { nowInSeoulBusinessDay, todayInSeoul, isWithinEditWindow } from "./time";

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
}): Promise<{ id: string; createdAt: string }> {
  const points = validateGameInput(input);

  // Date/time are never taken from the client — the server's own clock at
  // record time is the source of truth (PRD 8.3), converted to Asia/Seoul
  // wall-clock since that's what every displayed date/time in this app means.
  // `date` is the *business* date (v2.16: 06:00-30:00 day) so a session that
  // runs past real midnight still gets grouped with the night it started.
  const { date, time } = nowInSeoulBusinessDay();

  const game = await insertGame({
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

  // Returned so the client can offer an immediate "N판 기록됨 · 되돌리기"
  // affordance (PRD §24.9/§24.11) without a separate lookup — same shape as
  // recordSettlement's existing return value.
  return { id: game.id, createdAt: game.createdAt };
}

/**
 * Correction of an existing game record (see PRD 11, extended by PRD 15 to
 * non-admins). Branches on session:
 *  - Admin: behaves exactly as before — date/time/active are taken from the
 *    caller as-is (the one deliberate exception to "server clock is the
 *    source of truth", so an admin can fix a record without losing its
 *    originally recorded moment the way delete-and-recreate would), no time
 *    limit.
 *  - Non-admin: date/time/active are NEVER taken from the caller, no matter
 *    what the client sends — they're always carried over from the existing
 *    row, so tampering with the request can't bypass this. Only allowed
 *    within EDIT_WINDOW_MS of the row's createdAt, and only for rows that
 *    are still active (a soft-deleted row is admin territory only, same as
 *    it never being shown to non-admins in the first place).
 */
export async function updateGame(
  id: string,
  input: {
    gameType: GameType;
    attendeeIds: string[];
    winnerId: string;
    loserId: string;
    points?: number;
    note?: string;
    date?: string;
    time?: string;
    active?: boolean;
  }
) {
  const existing = await getGameById(id);
  if (!existing) throw new Error("게임 기록을 찾을 수 없습니다.");

  const points = validateGameInput(input);
  const admin = await isAdminSession();

  let date: string;
  let time: string;
  let active: boolean;

  if (admin) {
    if (
      input.date === undefined ||
      input.time === undefined ||
      input.active === undefined
    ) {
      throw new Error("날짜·시간·상태 값이 필요합니다.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
      throw new Error("날짜 형식이 올바르지 않습니다.");
    }
    if (!/^\d{2}:\d{2}$/.test(input.time)) {
      throw new Error("시간 형식이 올바르지 않습니다.");
    }
    date = input.date;
    time = input.time;
    active = input.active;
  } else {
    if (existing.active === false) {
      throw new Error("비활성화된 기록은 관리자만 수정할 수 있습니다.");
    }
    if (!isWithinEditWindow(existing.createdAt)) {
      throw new Error("기록 후 2시간이 지나 더 이상 수정할 수 없습니다.");
    }
    date = existing.date;
    time = existing.time ?? "00:00";
    active = true; // guaranteed above — existing.active === false already threw
  }

  await updateGameRow(id, {
    date,
    time,
    gameType: input.gameType,
    points,
    active,
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
 * Open to non-admins since PRD 15, but only within EDIT_WINDOW_MS of the
 * row's createdAt — admins remain unrestricted.
 */
export async function deleteGame(id: string) {
  if (!(await isAdminSession())) {
    const existing = await getGameById(id);
    if (!existing) throw new Error("게임 기록을 찾을 수 없습니다.");
    if (!isWithinEditWindow(existing.createdAt)) {
      throw new Error("기록 후 2시간이 지나 더 이상 삭제할 수 없습니다.");
    }
  }

  await softDeleteGame(id);

  revalidatePath("/games");
  revalidatePath("/settlements");
  revalidatePath("/stats");
  revalidatePath("/");
}

/**
 * v2.19 (배치 B, PRD §24.11): undoes deleteGame — the "되돌리기" half of the
 * soft-delete snackbar. Same permission shape as deleteGame itself (open to
 * non-admins within the row's own edit window; admins unrestricted), rather
 * than routing through updateGame, which explicitly refuses to touch a row
 * that's already `active === false` for non-admins — that guard exists to
 * keep non-admins out of admin-only reactivation, but this action *is* that
 * reactivation, scoped to "undo the delete I just made".
 */
export async function restoreGame(id: string) {
  if (!(await isAdminSession())) {
    const existing = await getGameById(id);
    if (!existing) throw new Error("게임 기록을 찾을 수 없습니다.");
    if (!isWithinEditWindow(existing.createdAt)) {
      throw new Error("기록 후 2시간이 지나 더 이상 되돌릴 수 없습니다.");
    }
  }

  await restoreGameRow(id);

  revalidatePath("/games");
  revalidatePath("/settlements");
  revalidatePath("/stats");
  revalidatePath("/");
}

/**
 * Admin-only permanent delete — unlike deleteGame (soft delete), this cannot
 * be undone and the row cannot be recovered via the rollback screen either.
 * Offered as an explicit alternative to soft delete, not a replacement for
 * it (see PRD 13).
 */
export async function hardDeleteGame(id: string) {
  await requireAdmin();
  await deleteGameRow(id);

  // Same set as deleteGame, plus /games/new: deleting the most recent game
  // can change getPreviousAttendeeIds()'s result.
  revalidatePath("/games");
  revalidatePath("/games/new");
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
}): Promise<{ id: string; createdAt: string }> {
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
  // affordance right after the confirm step (PRD 9.1.4), good for
  // EDIT_WINDOW_MS from this exact server-side createdAt (PRD 15), without
  // needing a separate lookup.
  return { id: settlement.id, createdAt: settlement.createdAt };
}

/**
 * Open to non-admins since PRD 15, but only within EDIT_WINDOW_MS of the
 * settlement's createdAt — admins remain unrestricted (and can always fall
 * back to the rollback screen for anything older, PRD 15.2).
 */
export async function deleteSettlement(id: string) {
  if (!(await isAdminSession())) {
    const existing = await getSettlementById(id);
    if (!existing) throw new Error("정산 기록을 찾을 수 없습니다.");
    if (!isWithinEditWindow(existing.createdAt)) {
      throw new Error("기록 후 2시간이 지나 더 이상 취소할 수 없습니다.");
    }
  }

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
