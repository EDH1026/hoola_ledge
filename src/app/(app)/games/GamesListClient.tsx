"use client";

import { useMemo, useState, useTransition } from "react";
import { format } from "date-fns";
import { deleteGame } from "@/lib/actions";
import { withinDayKey } from "@/lib/games";
import { GameResult } from "@/lib/types";
import { GameTypeBadge } from "@/components/badges";

interface ParticipantLite {
  id: string;
  name: string;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

export default function GamesListClient({
  games,
  participants,
  sequenceNumbers,
}: {
  games: GameResult[];
  participants: ParticipantLite[];
  sequenceNumbers: Record<string, number>;
}) {
  const nameMap = useMemo(
    () => new Map(participants.map((p) => [p.id, p.name])),
    [participants]
  );

  const years = useMemo(() => {
    const set = new Set(games.map((g) => g.date.slice(0, 4)));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [games]);

  const [year, setYear] = useState("all");
  const [month, setMonth] = useState("all");
  const [day, setDay] = useState("all");
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return games
      .filter((g) => {
        const [y, m, d] = g.date.split("-");
        if (year !== "all" && y !== year) return false;
        if (month !== "all" && String(Number(m)) !== month) return false;
        if (day !== "all" && String(Number(d)) !== day) return false;
        return true;
      })
      .sort((a, b) =>
        b.date === a.date
          ? withinDayKey(b).localeCompare(withinDayKey(a))
          : b.date.localeCompare(a.date)
      );
  }, [games, year, month, day]);

  const pointsSum = filtered.reduce((sum, g) => sum + (g.points ?? 1), 0);

  function handleDelete(id: string) {
    setDeletingId(id);
    startTransition(async () => {
      await deleteGame(id);
      setDeletingId(null);
    });
  }

  return (
    <div className="space-y-4">
      <section className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <span className="text-xs text-slate-400 block mb-1">연도</span>
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="all">전체</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="text-xs text-slate-400 block mb-1">월</span>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="all">전체</option>
              {MONTHS.map((m) => (
                <option key={m} value={String(m)}>
                  {m}월
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="text-xs text-slate-400 block mb-1">일</span>
            <select
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="all">전체</option>
              {DAYS.map((d) => (
                <option key={d} value={String(d)}>
                  {d}일
                </option>
              ))}
            </select>
          </div>
          <div className="ml-auto text-sm text-slate-500">
            {filtered.length}회 · 점수 합계{" "}
            <span className="font-semibold text-slate-900">{pointsSum}점</span>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-400 p-5">
            조건에 맞는 게임 기록이 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((g) => {
              const seq = sequenceNumbers[g.id];
              const attendeeNames = g.attendeeIds.map(
                (id) => nameMap.get(id) ?? "(삭제됨)"
              );
              const points = g.points ?? 1;
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
                    <button
                      type="button"
                      onClick={() => handleDelete(g.id)}
                      disabled={isPending && deletingId === g.id}
                      className="text-xs text-slate-300 hover:text-red-600 disabled:opacity-50"
                    >
                      {isPending && deletingId === g.id ? "삭제 중..." : "삭제"}
                    </button>
                  </div>
                  <div className="text-sm">
                    <span className="font-semibold text-emerald-600">
                      {nameMap.get(g.winnerId) ?? "(삭제됨)"}
                    </span>
                    <span className="text-slate-400 mx-1.5">Win · Lose</span>
                    <span className="font-semibold text-red-500">
                      {nameMap.get(g.loserId) ?? "(삭제됨)"}
                    </span>
                    <span className="text-xs text-slate-400 ml-2">
                      · {points}점
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
