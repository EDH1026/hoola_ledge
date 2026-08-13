// One-shot migration: reads the existing production DB (a single db.json
// blob in Vercel Blob storage) and inserts every record into the new
// Supabase (Postgres) tables, preserving id/createdAt exactly.
//
// This is NOT re-runnable against a populated database — it checks that all
// four tables are empty first and aborts otherwise, specifically to prevent
// accidental double-insertion. Run it exactly once, right after applying
// supabase/schema.sql and confirming the app's Supabase-backed CRUD works
// against the empty tables (see README.md's migration section).
//
// Usage:
//   npx tsx scripts/migrate-to-supabase.ts
//
// Required in .env.local (this script loads it itself; `npx tsx` does not
// load .env.local automatically):
//   BLOB_READ_WRITE_TOKEN       — the EXISTING token for the production Blob store
//   SUPABASE_URL                — the new Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY   — the new Supabase service role key

import { readFileSync, existsSync } from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import {
  DB,
  Participant,
  GameResult,
  Settlement,
  LedgerAdjustment,
  normalizeSettlementType,
} from "../src/lib/types";

// ---------- .env.local loader (no dotenv dependency — this project has
// avoided adding it, and the parsing needed here is a few lines) ----------
function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, "utf-8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvLocal();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`FAIL: ${name} 환경변수가 .env.local에 설정되어 있지 않습니다.`);
    process.exit(1);
  }
  return value;
}

// ---------- Step 1: read the existing production data from Vercel Blob ----------
// Mirrors the old readBlob() that used to live in src/lib/storage.ts before
// the v2.11 migration (that function no longer exists in app code — this
// script is intentionally self-contained so it keeps working even after the
// app has fully moved to Supabase).
const BLOB_PATHNAME = "game-ledger/db.json";

function normalizeDB(db: Partial<DB>): DB {
  return {
    participants: db.participants ?? [],
    games: db.games ?? [],
    settlements: db.settlements ?? [],
    adjustments: db.adjustments ?? [],
  };
}

async function readBlobDB(): Promise<DB> {
  const { get } = await import("@vercel/blob");
  const result = await get(BLOB_PATHNAME, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) {
    console.error("FAIL: Vercel Blob에서 game-ledger/db.json을 읽지 못했습니다.");
    process.exit(1);
  }
  const text = await new Response(result.stream).text();
  return normalizeDB(JSON.parse(text) as Partial<DB>);
}

async function main() {
  requireEnv("BLOB_READ_WRITE_TOKEN");
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const supabaseKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  console.log("Vercel Blob에서 기존 데이터를 읽는 중...");
  const db = await readBlobDB();
  console.log(
    `읽음: 참가자 ${db.participants.length}명, 게임 ${db.games.length}건, ` +
      `정산 ${db.settlements.length}건, 과거기록 ${db.adjustments.length}건`
  );

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---------- Step 2: refuse to run against a non-empty database ----------
  console.log("\n대상 테이블이 비어있는지 확인하는 중...");
  const tables = ["participants", "games", "settlements", "adjustments"] as const;
  for (const table of tables) {
    const { count, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true });
    if (error) {
      console.error(`FAIL: ${table} 테이블 확인 중 오류: ${error.message}`);
      console.error(
        "supabase/schema.sql을 먼저 Supabase SQL Editor에서 실행했는지 확인하세요."
      );
      process.exit(1);
    }
    if ((count ?? 0) > 0) {
      console.error(
        `FAIL: ${table} 테이블에 이미 ${count}건의 데이터가 있습니다. ` +
          "중복 삽입을 막기 위해 중단합니다. (이 스크립트는 빈 테이블에만 실행할 수 있습니다.)"
      );
      process.exit(1);
    }
  }
  console.log("확인 완료: 4개 테이블 모두 비어 있습니다.");

  // ---------- Step 3: insert, preserving id/createdAt, in FK-safe order ----------
  // participants first (games/settlements/adjustments reference it), then
  // games, then settlements/adjustments (order between the two doesn't
  // matter — neither references the other).

  console.log("\n참가자 삽입 중...");
  const participantRows = db.participants.map((p: Participant) => ({
    id: p.id,
    name: p.name,
    active: p.active,
    created_at: p.createdAt,
  }));
  if (participantRows.length > 0) {
    const { error } = await supabase.from("participants").insert(participantRows);
    if (error) {
      console.error(`FAIL: 참가자 삽입 실패: ${error.message}`);
      process.exit(1);
    }
  }

  console.log("게임 기록 삽입 중...");
  const gameRows = db.games.map((g: GameResult) => ({
    id: g.id,
    date: g.date,
    time: g.time ?? null,
    game_type: g.gameType ?? null,
    points: g.points ?? 1, // legacy default, see PRD 10.2
    active: g.active ?? true, // legacy default, see PRD 10.2
    attendee_ids: g.attendeeIds,
    winner_id: g.winnerId,
    loser_id: g.loserId,
    note: g.note ?? null,
    created_at: g.createdAt,
  }));
  if (gameRows.length > 0) {
    const { error } = await supabase.from("games").insert(gameRows);
    if (error) {
      console.error(`FAIL: 게임 기록 삽입 실패: ${error.message}`);
      process.exit(1);
    }
  }

  console.log("정산 기록 삽입 중...");
  const settlementRows = db.settlements.map((s: Settlement) => ({
    id: s.id,
    type: normalizeSettlementType(s.type), // legacy "waiver" -> "donation"
    from_id: s.fromId,
    to_id: s.toId,
    amount: s.amount,
    date: s.date,
    note: s.note ?? null,
    created_at: s.createdAt,
  }));
  if (settlementRows.length > 0) {
    const { error } = await supabase.from("settlements").insert(settlementRows);
    if (error) {
      console.error(`FAIL: 정산 기록 삽입 실패: ${error.message}`);
      process.exit(1);
    }
  }

  console.log("과거 누적기록 삽입 중...");
  const adjustmentRows = db.adjustments.map((a: LedgerAdjustment) => ({
    id: a.id,
    from_id: a.fromId,
    to_id: a.toId,
    amount: a.amount,
    date: a.date,
    note: a.note ?? null,
    created_at: a.createdAt,
  }));
  if (adjustmentRows.length > 0) {
    const { error } = await supabase.from("adjustments").insert(adjustmentRows);
    if (error) {
      console.error(`FAIL: 과거 누적기록 삽입 실패: ${error.message}`);
      process.exit(1);
    }
  }

  // ---------- Step 4: verify row counts match ----------
  console.log("\n검증 중...");
  let allOk = true;
  for (const [table, sourceLength] of [
    ["participants", db.participants.length],
    ["games", db.games.length],
    ["settlements", db.settlements.length],
    ["adjustments", db.adjustments.length],
  ] as const) {
    const { count, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true });
    const actual = error ? -1 : count ?? 0;
    const ok = actual === sourceLength;
    if (!ok) allOk = false;
    const label =
      table === "participants"
        ? "참가자"
        : table === "games"
        ? "게임"
        : table === "settlements"
        ? "정산"
        : "과거기록";
    console.log(`${ok ? "PASS" : "FAIL"}: ${label}: ${actual}/${sourceLength}`);
  }

  if (!allOk) {
    console.error("\n일부 테이블의 행 수가 원본과 일치하지 않습니다. 위 로그를 확인하세요.");
    process.exit(1);
  }
  console.log("\n마이그레이션 완료. 모든 테이블의 행 수가 원본과 일치합니다.");
}

main().catch((err) => {
  console.error("FAIL: 예상치 못한 오류:", err);
  process.exit(1);
});
