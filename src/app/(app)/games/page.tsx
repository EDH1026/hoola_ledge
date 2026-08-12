import Link from "next/link";
import { format } from "date-fns";
import { readDB } from "@/lib/storage";
import { deleteGame } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function GamesPage() {
  const db = await readDB();
  const nameMap = new Map(db.participants.map((p) => [p.id, p.name]));
  const games = [...db.games].sort((a, b) =>
    b.date === a.date
      ? b.createdAt.localeCompare(a.createdAt)
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
              return (
                <li
                  key={g.id}
                  className="p-4 flex flex-wrap items-center gap-3 justify-between"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm text-slate-400 w-24">
                      {format(new Date(g.date), "yyyy-MM-dd")}
                    </span>
                    <span className="text-sm">
                      <span className="font-semibold text-emerald-600">
                        {nameMap.get(g.winnerId) ?? "(삭제됨)"}
                      </span>
                      <span className="text-slate-400 mx-1.5">1등 · 꼴찌</span>
                      <span className="font-semibold text-red-500">
                        {nameMap.get(g.loserId) ?? "(삭제됨)"}
                      </span>
                    </span>
                    {g.note && (
                      <span className="text-xs text-slate-400">· {g.note}</span>
                    )}
                    <span className="text-xs text-slate-300">
                      참가 {g.attendeeIds.length}명
                    </span>
                  </div>
                  <form action={deleteWithId}>
                    <button
                      type="submit"
                      className="text-xs text-slate-300 hover:text-red-600"
                    >
                      삭제
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
