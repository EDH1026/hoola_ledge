import Link from "next/link";
import { format } from "date-fns";
import { readDB } from "@/lib/storage";
import { deleteGame } from "@/lib/actions";
import { computeDailySequenceNumbers, withinDayKey } from "@/lib/games";
import { GameTypeBadge } from "@/components/badges";

export const dynamic = "force-dynamic";

export default async function GamesPage() {
  const db = await readDB();
  const nameMap = new Map(db.participants.map((p) => [p.id, p.name]));
  const sequenceNumbers = computeDailySequenceNumbers(db.games);
  // Newest date first; within a date, same key computeDailySequenceNumbers
  // uses (descending) so the N차전 label next to each row always matches
  // its position in this list.
  const games = [...db.games].sort((a, b) =>
    b.date === a.date
      ? withinDayKey(b).localeCompare(withinDayKey(a))
      : b.date.localeCompare(a.date)
  );

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

      <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {games.length === 0 ? (
          <p className="text-sm text-slate-400 p-5">아직 기록된 게임이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {games.map((g) => {
              const deleteWithId = deleteGame.bind(null, g.id);
              const seq = sequenceNumbers.get(g.id);
              const attendeeNames = g.attendeeIds.map(
                (id) => nameMap.get(id) ?? "(삭제됨)"
              );
              return (
                <li key={g.id} className="p-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-2 justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-slate-400 whitespace-nowrap">
                        {format(new Date(g.date), "yyyy-MM-dd")}
                        {g.time ? ` ${g.time}` : ""}
                        {seq ? ` · ${seq}차전` : ""}
                      </span>
                      <GameTypeBadge gameType={g.gameType} />
                    </div>
                    <form action={deleteWithId}>
                      <button
                        type="submit"
                        className="text-xs text-slate-300 hover:text-red-600"
                      >
                        삭제
                      </button>
                    </form>
                  </div>
                  <div className="text-sm">
                    <span className="font-semibold text-emerald-600">
                      {nameMap.get(g.winnerId) ?? "(삭제됨)"}
                    </span>
                    <span className="text-slate-400 mx-1.5">Win · Lose</span>
                    <span className="font-semibold text-red-500">
                      {nameMap.get(g.loserId) ?? "(삭제됨)"}
                    </span>
                    {g.note && (
                      <span className="text-xs text-slate-400 ml-2">
                        · {g.note}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    참석 {g.attendeeIds.length}명 · {attendeeNames.join(", ")}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
