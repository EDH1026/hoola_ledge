"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  LineChart,
  Line,
} from "recharts";
import { GameResult } from "@/lib/types";
import {
  computeParticipantStats,
  groupGamesByPeriod,
  filterGamesByPreset,
  PeriodGrouping,
  RangePreset,
} from "@/lib/stats";

interface ParticipantLite {
  id: string;
  name: string;
  active: boolean;
}

const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: "7d", label: "최근 7일" },
  { value: "30d", label: "최근 30일" },
  { value: "90d", label: "최근 90일" },
  { value: "year", label: "올해" },
  { value: "all", label: "전체" },
];

const GROUPING_OPTIONS: { value: PeriodGrouping; label: string }[] = [
  { value: "day", label: "일별" },
  { value: "week", label: "주별" },
  { value: "month", label: "월별" },
  { value: "year", label: "연도별" },
];

const PALETTE = [
  "#0f172a",
  "#059669",
  "#d97706",
  "#dc2626",
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#0891b2",
  "#65a30d",
  "#ea580c",
];

export default function StatsClient({
  participants,
  games,
}: {
  participants: ParticipantLite[];
  games: GameResult[];
}) {
  const [range, setRange] = useState<RangePreset>("30d");
  const [grouping, setGrouping] = useState<PeriodGrouping>("week");

  const filteredGames = useMemo(
    () => filterGamesByPreset(games, range),
    [games, range]
  );

  const stats = useMemo(
    () => computeParticipantStats(participants, filteredGames),
    [participants, filteredGames]
  );
  const activeStats = stats.filter((s) => s.appearances > 0);

  const buckets = useMemo(
    () => groupGamesByPeriod(filteredGames, grouping),
    [filteredGames, grouping]
  );

  const trendData = buckets.map((b) => ({
    label: b.label,
    게임수: b.gameCount,
  }));

  const winLossData = activeStats.map((s) => ({
    name: s.name,
    승: s.wins,
    패: s.losses,
  }));

  // cumulative net-points-over-time per participant, sampled at each game
  const sortedGames = useMemo(
    () =>
      [...filteredGames].sort((a, b) =>
        a.date === b.date
          ? a.createdAt.localeCompare(b.createdAt)
          : a.date.localeCompare(b.date)
      ),
    [filteredGames]
  );

  const cumulativeData = useMemo(() => {
    const running = new Map<string, number>();
    const nameOf = new Map(participants.map((p) => [p.id, p.name]));
    return sortedGames.map((g, i) => {
      running.set(g.winnerId, (running.get(g.winnerId) ?? 0) + 1);
      running.set(g.loserId, (running.get(g.loserId) ?? 0) - 1);
      const row: Record<string, string | number> = {
        label: `${g.date} #${i + 1}`,
      };
      for (const [id, val] of running.entries()) {
        row[nameOf.get(id) ?? id] = val;
      }
      return row;
    });
  }, [sortedGames, participants]);

  const trackedNames = useMemo(() => {
    const names = new Set<string>();
    for (const row of cumulativeData) {
      for (const key of Object.keys(row)) {
        if (key !== "label") names.add(key);
      }
    }
    return Array.from(names);
  }, [cumulativeData]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4 bg-white rounded-2xl border border-slate-200 p-4">
        <div>
          <span className="text-xs text-slate-400 block mb-1">기간</span>
          <div className="flex gap-1">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setRange(opt.value)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition ${
                  range === opt.value
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="text-xs text-slate-400 block mb-1">추이 단위</span>
          <div className="flex gap-1">
            {GROUPING_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setGrouping(opt.value)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition ${
                  grouping === opt.value
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-4">순위표 ({filteredGames.length}게임 기준)</h2>
        {activeStats.length === 0 ? (
          <p className="text-sm text-slate-400">해당 기간에 게임 기록이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 text-xs">
                  <th className="py-2 pr-4">이름</th>
                  <th className="py-2 pr-4">참여</th>
                  <th className="py-2 pr-4">승</th>
                  <th className="py-2 pr-4">패</th>
                  <th className="py-2 pr-4">승률</th>
                  <th className="py-2 pr-4">순점수</th>
                </tr>
              </thead>
              <tbody>
                {activeStats
                  .slice()
                  .sort((a, b) => b.netPoints - a.netPoints)
                  .map((s) => (
                    <tr key={s.id} className="border-t border-slate-100">
                      <td className="py-2 pr-4 font-medium">{s.name}</td>
                      <td className="py-2 pr-4 text-slate-500">{s.appearances}</td>
                      <td className="py-2 pr-4 text-emerald-600">{s.wins}</td>
                      <td className="py-2 pr-4 text-red-500">{s.losses}</td>
                      <td className="py-2 pr-4 text-slate-500">
                        {(s.winRate * 100).toFixed(0)}%
                      </td>
                      <td
                        className={`py-2 pr-4 font-semibold ${
                          s.netPoints > 0
                            ? "text-emerald-600"
                            : s.netPoints < 0
                            ? "text-red-500"
                            : "text-slate-400"
                        }`}
                      >
                        {s.netPoints > 0 ? "+" : ""}
                        {s.netPoints}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-4">참가자별 승 / 패</h2>
        {winLossData.length === 0 ? (
          <p className="text-sm text-slate-400">데이터가 없습니다.</p>
        ) : (
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={winLossData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="승" fill="#059669" radius={[4, 4, 0, 0]} />
                <Bar dataKey="패" fill="#dc2626" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-4">기간별 게임 수 추이</h2>
        {trendData.length === 0 ? (
          <p className="text-sm text-slate-400">데이터가 없습니다.</p>
        ) : (
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="게임수" fill="#0f172a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-4">참가자별 누적 순점수 추이</h2>
        {cumulativeData.length === 0 ? (
          <p className="text-sm text-slate-400">데이터가 없습니다.</p>
        ) : (
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <LineChart data={cumulativeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} hide={cumulativeData.length > 20} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                {trackedNames.map((name, i) => (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    stroke={PALETTE[i % PALETTE.length]}
                    dot={false}
                    strokeWidth={2}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  );
}
