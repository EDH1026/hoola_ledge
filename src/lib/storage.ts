import "server-only";
import { getSupabase } from "./supabase";
import {
  DB,
  GameResult,
  GameType,
  LedgerAdjustment,
  Participant,
  Settlement,
  SettlementType,
} from "./types";

// Data access layer for Supabase (Postgres) — see supabase/schema.sql for the
// table definitions this maps to. Replaces the old local-file/Vercel-Blob
// "read whole DB, mutate in memory, write whole DB back" adapter (mutateDB)
// with targeted per-table queries; Postgres's row-level atomicity is enough
// for this app's write patterns (almost everything is a single-row insert/
// update/delete), so there's no need for the old in-memory mutation queue.

function unwrap<T>({
  data,
  error,
}: {
  data: T | null;
  error: { message: string } | null;
}): T {
  if (error) throw new Error(error.message);
  if (data === null) throw new Error("Supabase 응답에 데이터가 없습니다.");
  return data;
}

// Postgres timestamptz comes back from PostgREST as e.g.
// "2026-08-13T03:55:08.272+00:00", but every createdAt this app has ever
// generated (and still generates, in insert calls below) uses
// `new Date().toISOString()`, which always ends in "Z". The two strings
// represent the same instant but sort/compare differently as plain text
// (admin rollback compares createdAt as strings), so every read normalizes
// through `new Date(...).toISOString()` to guarantee one canonical format.
function toIso(ts: string): string {
  return new Date(ts).toISOString();
}

// Postgres `time` returns "HH:mm:ss"; the app has always used "HH:mm".
function trimTime(t: string | null): string | undefined {
  return t ? t.slice(0, 5) : undefined;
}

interface ParticipantRow {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
}

interface GameRow {
  id: string;
  date: string;
  time: string | null;
  game_type: GameType | null;
  points: number;
  active: boolean;
  attendee_ids: string[];
  winner_id: string;
  loser_id: string;
  note: string | null;
  created_at: string;
}

interface SettlementRow {
  id: string;
  type: SettlementType;
  from_id: string;
  to_id: string;
  amount: number;
  date: string;
  note: string | null;
  created_at: string;
}

interface AdjustmentRow {
  id: string;
  from_id: string;
  to_id: string;
  amount: number;
  note: string | null;
  date: string;
  created_at: string;
}

function mapParticipant(row: ParticipantRow): Participant {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    createdAt: toIso(row.created_at),
  };
}

function mapGame(row: GameRow): GameResult {
  return {
    id: row.id,
    date: row.date,
    time: trimTime(row.time),
    gameType: row.game_type ?? undefined,
    points: row.points,
    active: row.active,
    attendeeIds: row.attendee_ids,
    winnerId: row.winner_id,
    loserId: row.loser_id,
    note: row.note ?? undefined,
    createdAt: toIso(row.created_at),
  };
}

function mapSettlement(row: SettlementRow): Settlement {
  return {
    id: row.id,
    type: row.type,
    fromId: row.from_id,
    toId: row.to_id,
    amount: row.amount,
    date: row.date,
    note: row.note ?? undefined,
    createdAt: toIso(row.created_at),
  };
}

function mapAdjustment(row: AdjustmentRow): LedgerAdjustment {
  return {
    id: row.id,
    fromId: row.from_id,
    toId: row.to_id,
    amount: row.amount,
    note: row.note ?? undefined,
    date: row.date,
    createdAt: toIso(row.created_at),
  };
}

// ---------- Participants ----------

export async function listParticipants(): Promise<Participant[]> {
  const { data, error } = await getSupabase()
    .from("participants")
    .select("*")
    .order("name");
  return unwrap({ data, error }).map(mapParticipant);
}

export async function insertParticipant(name: string): Promise<Participant> {
  const { data, error } = await getSupabase()
    .from("participants")
    .insert({ name })
    .select()
    .single();
  return mapParticipant(unwrap({ data, error }));
}

export async function updateParticipantName(id: string, name: string): Promise<void> {
  const { error } = await getSupabase().from("participants").update({ name }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function updateParticipantActive(id: string, active: boolean): Promise<void> {
  const { error } = await getSupabase()
    .from("participants")
    .update({ active })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------- Games ----------

export async function listGames(): Promise<GameResult[]> {
  const { data, error } = await getSupabase().from("games").select("*");
  return unwrap({ data, error }).map(mapGame);
}

/** Targeted query for the "default to previous game's attendees" behavior — avoids fetching every game just to find the latest one. */
export async function getMostRecentActiveAttendeeIds(): Promise<string[]> {
  const { data, error } = await getSupabase()
    .from("games")
    .select("attendee_ids")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // Unlike the other functions here, a null `data` from maybeSingle() is not
  // an error — it just means there's no previous game yet (e.g. right after
  // the tables are first created), which is the normal state to default to
  // an empty attendee list rather than throw. unwrap() intentionally isn't
  // used for that reason.
  if (error) throw new Error(error.message);
  return data?.attendee_ids ?? [];
}

export async function insertGame(input: {
  date: string;
  time: string;
  gameType: GameType;
  points: number;
  attendeeIds: string[];
  winnerId: string;
  loserId: string;
  note?: string;
}): Promise<GameResult> {
  const { data, error } = await getSupabase()
    .from("games")
    .insert({
      date: input.date,
      time: input.time,
      game_type: input.gameType,
      points: input.points,
      attendee_ids: input.attendeeIds,
      winner_id: input.winnerId,
      loser_id: input.loserId,
      note: input.note ?? null,
    })
    .select()
    .single();
  return mapGame(unwrap({ data, error }));
}

/** Soft delete: active=false, so the row is excluded from balances/stats/lists (see activeGames() in games.ts) but survives for admin rollback. */
export async function softDeleteGame(id: string): Promise<void> {
  const { error } = await getSupabase().from("games").update({ active: false }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** v2.19 (배치 B, PRD §24.11): exact inverse of softDeleteGame, for the "삭제됨 · 되돌리기" snackbar — undoes a soft delete without touching any other column. */
export async function restoreGame(id: string): Promise<void> {
  const { error } = await getSupabase().from("games").update({ active: true }).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Admin-only full-field update (see actions.ts updateGame) — unlike softDeleteGame,
 * this can touch every column including date/time and active, so an admin can
 * correct a mis-entered record without losing its originally recorded date/time
 * the way delete-and-recreate would (recreate always stamps the current instant).
 */
export async function updateGameRow(
  id: string,
  input: {
    date: string;
    time: string;
    gameType: GameType;
    points: number;
    active: boolean;
    attendeeIds: string[];
    winnerId: string;
    loserId: string;
    note?: string;
  }
): Promise<GameResult> {
  const { data, error } = await getSupabase()
    .from("games")
    .update({
      date: input.date,
      time: input.time,
      game_type: input.gameType,
      points: input.points,
      active: input.active,
      attendee_ids: input.attendeeIds,
      winner_id: input.winnerId,
      loser_id: input.loserId,
      note: input.note ?? null,
    })
    .eq("id", id)
    .select()
    .single();
  return mapGame(unwrap({ data, error }));
}

/** Hard delete: permanently removes the row (unlike softDeleteGame, this cannot be undone). Admin-only, see actions.ts hardDeleteGame. */
export async function deleteGameRow(id: string): Promise<void> {
  const { error } = await getSupabase().from("games").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Single-row lookup — used by updateGame/deleteGame (v2.14) to read `createdAt` and existing values before deciding whether a non-admin edit/delete is still within the 2-hour window. Returns null if the row doesn't exist, rather than throwing. */
export async function getGameById(id: string): Promise<GameResult | null> {
  const { data, error } = await getSupabase()
    .from("games")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapGame(data) : null;
}

// ---------- Settlements ----------

export async function listSettlements(): Promise<Settlement[]> {
  const { data, error } = await getSupabase().from("settlements").select("*");
  return unwrap({ data, error }).map(mapSettlement);
}

export async function insertSettlement(input: {
  fromId: string;
  toId: string;
  amount: number;
  type: SettlementType;
  date: string;
  note?: string;
}): Promise<Settlement> {
  const { data, error } = await getSupabase()
    .from("settlements")
    .insert({
      type: input.type,
      from_id: input.fromId,
      to_id: input.toId,
      amount: input.amount,
      date: input.date,
      note: input.note ?? null,
    })
    .select()
    .single();
  return mapSettlement(unwrap({ data, error }));
}

export async function deleteSettlementRow(id: string): Promise<void> {
  const { error } = await getSupabase().from("settlements").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Single-row lookup — used by deleteSettlement (v2.14) to read `createdAt` before deciding whether a non-admin's undo is still within the 2-hour window. Returns null if the row doesn't exist, rather than throwing. */
export async function getSettlementById(id: string): Promise<Settlement | null> {
  const { data, error } = await getSupabase()
    .from("settlements")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapSettlement(data) : null;
}

// ---------- Legacy ledger adjustments ----------

export async function listAdjustments(): Promise<LedgerAdjustment[]> {
  const { data, error } = await getSupabase().from("adjustments").select("*");
  return unwrap({ data, error }).map(mapAdjustment);
}

export async function insertAdjustment(input: {
  fromId: string;
  toId: string;
  amount: number;
  date: string;
  note?: string;
}): Promise<LedgerAdjustment> {
  const { data, error } = await getSupabase()
    .from("adjustments")
    .insert({
      from_id: input.fromId,
      to_id: input.toId,
      amount: input.amount,
      date: input.date,
      note: input.note ?? null,
    })
    .select()
    .single();
  return mapAdjustment(unwrap({ data, error }));
}

export async function updateAdjustmentRow(
  id: string,
  input: { fromId: string; toId: string; amount: number; date: string; note?: string }
): Promise<void> {
  const { error } = await getSupabase()
    .from("adjustments")
    .update({
      from_id: input.fromId,
      to_id: input.toId,
      amount: input.amount,
      date: input.date,
      note: input.note ?? null,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteAdjustmentRow(id: string): Promise<void> {
  const { error } = await getSupabase().from("adjustments").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------- Admin rollback ----------
// Deliberately independent of listGames()/listAdjustments()/listSettlements()
// (which exist for the app's normal read paths) — rollback must see and
// delete rows regardless of the games table's `active` flag, since a
// soft-deleted game created after the cutoff still needs to be hard-deleted
// and counted.

export interface RollbackCounts {
  games: number;
  settlements: number;
  adjustments: number;
}

export async function countRollbackTargets(cutoffIso: string): Promise<RollbackCounts> {
  const supabase = getSupabase();
  const [games, settlements, adjustments] = await Promise.all([
    supabase.from("games").select("id", { count: "exact", head: true }).gt("created_at", cutoffIso),
    supabase
      .from("settlements")
      .select("id", { count: "exact", head: true })
      .gt("created_at", cutoffIso),
    supabase
      .from("adjustments")
      .select("id", { count: "exact", head: true })
      .gt("created_at", cutoffIso),
  ]);
  if (games.error) throw new Error(games.error.message);
  if (settlements.error) throw new Error(settlements.error.message);
  if (adjustments.error) throw new Error(adjustments.error.message);
  return {
    games: games.count ?? 0,
    settlements: settlements.count ?? 0,
    adjustments: adjustments.count ?? 0,
  };
}

/** Calls the rollback_after(cutoff) Postgres function (supabase/schema.sql) so the three deletes run as one atomic transaction. */
export async function rollbackAfter(cutoffIso: string): Promise<RollbackCounts> {
  const { data, error } = await getSupabase()
    .rpc("rollback_after", { cutoff: cutoffIso })
    .single();
  const row = unwrap({ data, error }) as {
    games_deleted: number;
    settlements_deleted: number;
    adjustments_deleted: number;
  };
  return {
    games: row.games_deleted,
    settlements: row.settlements_deleted,
    adjustments: row.adjustments_deleted,
  };
}

// ---------- Convenience: full-DB fetch ----------
// For screens that genuinely need cross-table computation (dashboard,
// settlements — both feed computeNetBalances/simplifiedSettlements, which
// take all of games+settlements+adjustments). Screens that only need one or
// two tables (participants, games list, stats, new-game form) should call
// the targeted functions above instead.

export async function getFullDB(): Promise<DB> {
  const [participants, games, settlements, adjustments] = await Promise.all([
    listParticipants(),
    listGames(),
    listSettlements(),
    listAdjustments(),
  ]);
  return { participants, games, settlements, adjustments };
}
