import Link from "next/link";
import { readDB } from "@/lib/storage";
import { activeGames, computeDailySequenceNumbers } from "@/lib/games";
import GamesListClient from "./GamesListClient";

export const dynamic = "force-dynamic";

export default async function GamesPage() {
  const db = await readDB();
  const games = activeGames(db.games);

  // Computed over ALL active games (not the filtered subset) so N차전 numbers
  // never shift just because a year/month/day filter is applied on top.
  const sequenceNumbers: Record<string, number> = {};
  for (const [id, seq] of computeDailySequenceNumbers(db.games)) {
    sequenceNumbers[id] = seq;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">게임 기록</h1>
          <p className="text-sm text-slate-500 mt-1">총 {games.length}회</p>
        </div>
        <Link
          href="/games/new"
          className="rounded-lg bg-slate-900 text-white text-sm font-medium px-4 py-2 hover:bg-slate-800 transition"
        >
          + 새 게임 기록
        </Link>
      </div>

      <GamesListClient
        games={games}
        participants={db.participants.map((p) => ({ id: p.id, name: p.name }))}
        sequenceNumbers={sequenceNumbers}
      />
    </div>
  );
}
