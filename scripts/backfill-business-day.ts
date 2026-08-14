// v2.17 — retroactively applies the v2.16 business-day rule (06:00-30:00) to
// `games` rows recorded before v2.16 shipped, which still carry a raw
// calendar `date` instead of a business date. See PRD §20 for the full
// diagnosis: the app's day-boundary logic itself has been correct since
// v2.16, but rows written before that release were never touched, so
// "8/14 저녁 ~ 8/15 01:00" games still render as split across two days.
//
// Decision logic lives in src/lib/backfill.ts (planBusinessDayBackfill) —
// this script is just the I/O shell around it: read every row, ask the pure
// function what to do, print a report, and only write when told to.
//
// Usage:
//   npx tsx scripts/backfill-business-day.ts                      (dry run — never writes)
//   npx tsx scripts/backfill-business-day.ts --apply               (actually updates `games`)
//   npx tsx scripts/backfill-business-day.ts --include-settlements (also plans `settlements`;
//                                                                    combine with --apply to write both)
//
// `adjustments` is deliberately never touched — admins type its dates in by
// hand for genuinely historical entries, so every row there would fall into
// planBusinessDayBackfill's "manually-edited" guard and be skipped anyway;
// there is no reason to even query that table here.
//
// Required in .env.local (this script loads it itself; `npx tsx` does not
// load .env.local automatically):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { readFileSync, existsSync } from "fs";
import path from "path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { planBusinessDayBackfill, BackfillVerdict } from "../src/lib/backfill";
import { seoulWallClockFromIso } from "../src/lib/time";

// ---------- .env.local loader (same self-contained approach as
// scripts/migrate-to-supabase.ts — this project has deliberately avoided
// adding a dotenv dependency for the few lines this needs) ----------
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

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const INCLUDE_SETTLEMENTS = args.includes("--include-settlements");

// Postgres `time` comes back as "HH:mm:ss"; the app has always used "HH:mm".
function trimTime(t: string | null): string | undefined {
  return t ? t.slice(0, 5) : undefined;
}

interface PlannedRow {
  id: string;
  before: { date: string; time?: string };
  seoul: { date: string; time: string }; // what createdAt actually says, for the report
  verdict: BackfillVerdict;
}

async function planTable(
  supabase: SupabaseClient,
  table: "games" | "settlements"
): Promise<PlannedRow[]> {
  // Soft-deleted games (active=false) are deliberately included — an admin
  // can still reactivate them later via §11/§13.6, and they should have the
  // right date when that happens. `settlements` has no `active` column.
  const { data, error } = await supabase.from(table).select("id, date, time, created_at");
  if (error) {
    console.error(`FAIL: ${table} 조회 실패: ${error.message}`);
    process.exit(1);
  }

  const rows = (data ?? []) as {
    id: string;
    date: string;
    time: string | null;
    created_at: string;
  }[];

  return rows.map((row) => {
    const createdAt = new Date(row.created_at).toISOString();
    const time = trimTime(row.time ?? null);
    const verdict = planBusinessDayBackfill({ date: row.date, time, createdAt });
    return {
      id: row.id,
      before: { date: row.date, time },
      seoul: seoulWallClockFromIso(createdAt),
      verdict,
    };
  });
}

function printReport(label: string, planned: PlannedRow[]) {
  const updates = planned.filter((p) => p.verdict.action === "update");
  const alreadyCorrect = planned.filter(
    (p) => p.verdict.action === "skip" && p.verdict.reason === "already-correct"
  );
  const manuallyEdited = planned.filter(
    (p) => p.verdict.action === "skip" && p.verdict.reason === "manually-edited"
  );

  console.log(`\n=== ${label} (${planned.length}건) ===`);

  if (updates.length > 0) {
    console.log(`\n갱신 대상 (${updates.length}건):`);
    for (const p of updates) {
      const v = p.verdict as Extract<BackfillVerdict, { action: "update" }>;
      const beforeStr = `${p.before.date}${p.before.time ? ` ${p.before.time}` : " (시간 없음)"}`;
      const afterStr = `${v.date}${v.time ? ` ${v.time}` : ""}`;
      console.log(
        `  ${p.id}  ${beforeStr}  ->  ${afterStr}   (createdAt Seoul ${p.seoul.date} ${p.seoul.time})`
      );
    }
  }

  if (manuallyEdited.length > 0) {
    console.log(`\n수동 수정 추정 — 건드리지 않음 (${manuallyEdited.length}건):`);
    for (const p of manuallyEdited) {
      console.log(
        `  ${p.id}  저장된 값: ${p.before.date}${
          p.before.time ? ` ${p.before.time}` : ""
        }   (createdAt Seoul ${p.seoul.date} ${p.seoul.time})`
      );
    }
  }

  console.log(
    `\n${label} 요약: 갱신 ${updates.length}건 / 정상 ${alreadyCorrect.length}건 / 수동수정 추정 ${manuallyEdited.length}건`
  );

  return { updates, alreadyCorrect, manuallyEdited };
}

async function applyUpdates(
  supabase: SupabaseClient,
  table: "games" | "settlements",
  updates: PlannedRow[]
): Promise<number> {
  let failed = 0;
  for (const p of updates) {
    const v = p.verdict as Extract<BackfillVerdict, { action: "update" }>;
    const patch: { date: string; time?: string } = { date: v.date };
    if (v.time) patch.time = v.time;
    const { error } = await supabase.from(table).update(patch).eq("id", p.id);
    if (error) {
      console.error(`FAIL: ${table} ${p.id} 갱신 실패: ${error.message}`);
      failed++;
    }
  }
  return failed;
}

async function main() {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const supabaseKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(
    APPLY
      ? "*** --apply 모드: 실제로 DB에 씁니다. ***"
      : "드라이런 모드 — 아무것도 쓰지 않습니다. 실제로 적용하려면 --apply를 붙여서 다시 실행하세요."
  );

  const gamesPlanned = await planTable(supabase, "games");
  const { updates: gameUpdates } = printReport("games", gamesPlanned);

  let settlementUpdates: PlannedRow[] = [];
  if (INCLUDE_SETTLEMENTS) {
    const settlementsPlanned = await planTable(supabase, "settlements");
    settlementUpdates = printReport("settlements", settlementsPlanned).updates;
  }

  if (!APPLY) {
    console.log(
      "\n(드라이런이었습니다. 위 목록을 확인한 뒤 `npx tsx scripts/backfill-business-day.ts --apply`로 실제 적용하세요.)"
    );
    return;
  }

  console.log("\n적용 중...");
  const failedGames = await applyUpdates(supabase, "games", gameUpdates);
  const failedSettlements = INCLUDE_SETTLEMENTS
    ? await applyUpdates(supabase, "settlements", settlementUpdates)
    : 0;

  const totalFailed = failedGames + failedSettlements;
  if (totalFailed > 0) {
    console.error(
      `\n${totalFailed}건 갱신 실패. 각 행은 독립적이고 멱등하므로 스크립트를 다시 실행하면 실패한 행만 다시 갱신됩니다.`
    );
    process.exit(1);
  }
  console.log(
    `\n완료: games ${gameUpdates.length}건${
      INCLUDE_SETTLEMENTS ? `, settlements ${settlementUpdates.length}건` : ""
    } 갱신됨.`
  );
}

main().catch((err) => {
  console.error("FAIL: 예상치 못한 오류:", err);
  process.exit(1);
});
