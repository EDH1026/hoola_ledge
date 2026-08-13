"use client";

import { useMemo, useState, type CSSProperties } from "react";
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
import { GAME_TYPE_LABELS, GAME_TYPES, GameResult } from "@/lib/types";
import { activeGames } from "@/lib/games";
import { TierBadge } from "@/components/badges";
import {
  computeParticipantStats,
  computeHeadToHead,
  computeHeadToHeadMatrix,
  computeNemesisAndVictim,
  computeGameTypeStats,
  computeRecords,
  computeTier,
  groupGamesByPeriod,
  filterGamesByPreset,
  filterGamesByType,
  GameTypeFilter,
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

const GAME_TYPE_OPTIONS: { value: GameTypeFilter; label: string }[] = [
  { value: "all", label: "전체" },
  ...GAME_TYPES.map((gt) => ({ value: gt, label: GAME_TYPE_LABELS[gt] })),
];

// Data-driven color intensity can't be expressed as static Tailwind classes
// (the scanner needs literal class strings), so the head-to-head matrix uses
// inline rgba() backgrounds instead. Alpha is floored at 0.12 so even a small
// nonzero net still reads as "slightly colored" rather than invisible, and
// capped at 0.65 so text stays legible without needing a text-color switch.
function heatmapStyle(net: number, maxAbs: number): CSSProperties {
  if (net === 0 || maxAbs === 0) return {};
  const t = Math.min(1, Math.abs(net) / maxAbs);
  const alpha = 0.12 + t * 0.53;
  const [r, g, b] = net > 0 ? [5, 150, 105] : [220, 38, 38]; // emerald-600 / red-600
  return { backgroundColor: `rgba(${r}, ${g}, ${b}, ${alpha})` };
}

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
  initialH2hParticipantId = null,
}: {
  participants: ParticipantLite[];
  games: GameResult[];
  initialH2hParticipantId?: string | null;
}) {
  const [range, setRange] = useState<RangePreset>("30d");
  const [grouping, setGrouping] = useState<PeriodGrouping>("week");
  const [gameType, setGameType] = useState<GameTypeFilter>("all");
  const [h2hParticipantId, setH2hParticipantId] = useState<string | null>(
    initialH2hParticipantId
  );

  const filteredGames = useMemo(
    () => filterGamesByType(filterGamesByPreset(activeGames(games), range), gameType),
    [games, range, gameType]
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

  // Only participants who actually show up in the current filter's results —
  // otherwise the matrix/nemesis-victim sections would be full of rows for
  // people who never played in the selected period/type.
  const matrixParticipants = useMemo(
    () => activeStats.map((s) => ({ id: s.id, name: s.name })),
    [activeStats]
  );

  const matrix = useMemo(
    () => computeHeadToHeadMatrix(matrixParticipants, filteredGames),
    [matrixParticipants, filteredGames]
  );
  const matrixMaxAbs = useMemo(
    () => matrix.reduce((max, c) => Math.max(max, Math.abs(c.netPoints)), 0),
    [matrix]
  );

  const nemesisVictim = useMemo(() => {
    const activeIds = new Set(matrixParticipants.map((p) => p.id));
    return computeNemesisAndVictim(participants, filteredGames).filter((nv) =>
      activeIds.has(nv.id)
    );
  }, [participants, matrixParticipants, filteredGames]);

  // 종목별 성적 intentionally ignores the page's own 종목 filter (a per-type
  // comparison is meaningless once already narrowed to one type) but still
  // respects the 기간 filter — see the note rendered under its heading.
  const periodOnlyGames = useMemo(
    () => filterGamesByPreset(activeGames(games), range),
    [games, range]
  );
  const gameTypeStats = useMemo(
    () => computeGameTypeStats(participants, periodOnlyGames),
    [participants, periodOnlyGames]
  );

  // 기록실은 항상 통산(전체 기간·전체 종목) 기준 — 필터를 타지 않는다는 걸
  // 아래 UI에 명시한다.
  const records = useMemo(
    () => computeRecords(participants, games),
    [participants, games]
  );

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
        <div>
          <span className="text-xs text-slate-400 block mb-1">종목</span>
          <div className="flex gap-1">
            {GAME_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setGameType(opt.value)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition ${
                  gameType === opt.value
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
        <h2 className="font-semibold">순위표 ({filteredGames.length}게임 기준)</h2>
        <p className="text-xs text-slate-400 mb-4">
          티어는 승률 기준(3경기 미만이면 랭크 미배정)입니다 — 브론즈 &lt;35% ·
          실버 &lt;45% · 골드 &lt;55% · 플래티넘 &lt;65% · 다이아몬드 &lt;75% ·
          챌린저 ≥75%.
        </p>
        {activeStats.length === 0 ? (
          <p className="text-sm text-slate-400">해당 기간에 게임 기록이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 text-xs">
                  <th className="py-2 pr-4">이름</th>
                  <th className="py-2 pr-4">티어</th>
                  <th className="py-2 pr-4">참여</th>
                  <th className="py-2 pr-4">승</th>
                  <th className="py-2 pr-4">패</th>
                  <th className="py-2 pr-4">승률</th>
                  <th className="py-2 pr-4">순점수</th>
                  <th className="py-2 pr-4" />
                </tr>
              </thead>
              <tbody>
                {activeStats
                  .slice()
                  .sort((a, b) => b.netPoints - a.netPoints)
                  .map((s) => (
                    <tr
                      key={s.id}
                      className={`border-t border-slate-100 ${
                        h2hParticipantId === s.id ? "bg-slate-50" : ""
                      }`}
                    >
                      <td className="py-2 pr-4 font-medium">{s.name}</td>
                      <td className="py-2 pr-4">
                        <TierBadge tier={computeTier(s.winRate, s.wins + s.losses)} />
                      </td>
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
                      <td className="py-2 pr-4">
                        <button
                          type="button"
                          onClick={() =>
                            setH2hParticipantId((cur) => (cur === s.id ? null : s.id))
                          }
                          className={`text-xs px-2 py-1 rounded-lg font-medium transition whitespace-nowrap ${
                            h2hParticipantId === s.id
                              ? "bg-slate-900 text-white"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                          }`}
                        >
                          상대 전적
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {h2hParticipantId && (
        <HeadToHeadPanel
          participants={participants}
          games={filteredGames}
          participantId={h2hParticipantId}
        />
      )}

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-1">상대 전적 매트릭스</h2>
        <p className="text-xs text-slate-400 mb-4">
          행 참가자가 열 참가자를 상대로 딴 순점수입니다. 초록은 우세, 빨강은
          열세이며 색이 진할수록 격차가 큽니다.
        </p>
        {matrixParticipants.length < 2 ? (
          <p className="text-sm text-slate-400">
            비교할 참가자가 2명 이상일 때 표시됩니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-sm border-collapse">
              <thead>
                <tr>
                  <th className="p-2" />
                  {matrixParticipants.map((p) => (
                    <th
                      key={p.id}
                      className="p-2 text-xs font-medium text-slate-500 whitespace-nowrap"
                    >
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixParticipants.map((row) => (
                  <tr key={row.id}>
                    <th className="p-2 text-xs font-medium text-slate-500 text-right whitespace-nowrap">
                      {row.name}
                    </th>
                    {matrixParticipants.map((col) => {
                      if (row.id === col.id) {
                        return (
                          <td
                            key={col.id}
                            className="p-2 text-center text-slate-300 bg-slate-50"
                          >
                            -
                          </td>
                        );
                      }
                      const cell = matrix.find(
                        (c) => c.rowId === row.id && c.colId === col.id
                      );
                      const net = cell?.netPoints ?? 0;
                      return (
                        <td
                          key={col.id}
                          className="p-2 text-center font-medium"
                          style={heatmapStyle(net, matrixMaxAbs)}
                        >
                          {cell && cell.games > 0 ? (net > 0 ? `+${net}` : net) : "-"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-4">천적 / 밥</h2>
        {nemesisVictim.filter((nv) => nv.nemesis || nv.victim).length === 0 ? (
          <p className="text-sm text-slate-400">
            아직 상대 전적을 계산할 만한 데이터가 없습니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 text-xs">
                  <th className="py-2 pr-4">이름</th>
                  <th className="py-2 pr-4">천적 (가장 많이 짐)</th>
                  <th className="py-2 pr-4">밥 (가장 많이 이김)</th>
                </tr>
              </thead>
              <tbody>
                {nemesisVictim
                  .filter((nv) => nv.nemesis || nv.victim)
                  .map((nv) => (
                    <tr key={nv.id} className="border-t border-slate-100">
                      <td className="py-2 pr-4 font-medium">{nv.name}</td>
                      <td className="py-2 pr-4 text-red-500">
                        {nv.nemesis
                          ? `${nv.nemesis.opponentName} (-${nv.nemesis.pointsLost})`
                          : "-"}
                      </td>
                      <td className="py-2 pr-4 text-emerald-600">
                        {nv.victim
                          ? `${nv.victim.opponentName} (+${nv.victim.pointsWon})`
                          : "-"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-1">종목별 성적</h2>
        <p className="text-xs text-slate-400 mb-4">
          이 표는 화면 상단의 종목 필터와 무관하게 항상 전체 종목을
          비교합니다 (기간 필터는 적용됩니다).
        </p>
        {gameTypeStats.length === 0 ? (
          <p className="text-sm text-slate-400">
            종목이 지정된 게임 기록이 아직 없습니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 text-xs">
                  <th className="py-2 pr-4">종목</th>
                  <th className="py-2 pr-4">이름</th>
                  <th className="py-2 pr-4">승</th>
                  <th className="py-2 pr-4">패</th>
                  <th className="py-2 pr-4">승률</th>
                  <th className="py-2 pr-4">순점수</th>
                </tr>
              </thead>
              <tbody>
                {GAME_TYPES.flatMap((gt) => {
                  const rows = gameTypeStats
                    .filter((s) => s.gameType === gt)
                    .sort((a, b) => b.netPoints - a.netPoints);
                  const best = rows[0];
                  return rows.map((s, i) => (
                    <tr key={`${gt}-${s.id}`} className="border-t border-slate-100">
                      <td className="py-2 pr-4 text-slate-500">
                        {i === 0 ? GAME_TYPE_LABELS[gt] : ""}
                      </td>
                      <td className="py-2 pr-4 font-medium">
                        {s.name}
                        {best && s.id === best.id && (
                          <span className="ml-1.5 text-xs text-amber-600 font-semibold">
                            최강
                          </span>
                        )}
                      </td>
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
                  ));
                })}
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

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-1">기록실</h2>
        <p className="text-xs text-slate-400 mb-4">
          위 기간·종목 필터와 무관하게 항상 통산 기준입니다.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <RecordTile
            label="최장 연승"
            value={
              records.longestWinStreak
                ? `${records.longestWinStreak.name} · ${records.longestWinStreak.value}연승`
                : null
            }
          />
          <RecordTile
            label="최장 연패"
            value={
              records.longestLossStreak
                ? `${records.longestLossStreak.name} · ${records.longestLossStreak.value}연패`
                : null
            }
          />
          <RecordTile
            label="단일 게임 최고 점수"
            value={
              records.highestSingleGamePoints
                ? `${records.highestSingleGamePoints.winnerName} vs ${records.highestSingleGamePoints.loserName} · ${records.highestSingleGamePoints.points}점 (${records.highestSingleGamePoints.date})`
                : null
            }
          />
          <RecordTile
            label="하루 최다 승리"
            value={
              records.mostWinsInOneDay
                ? `${records.mostWinsInOneDay.name} · ${records.mostWinsInOneDay.date}에 ${records.mostWinsInOneDay.wins}승`
                : null
            }
          />
          <RecordTile
            label="최다 참석 (개근왕)"
            value={
              records.mostAppearances
                ? `${records.mostAppearances.name} · ${records.mostAppearances.value}회`
                : null
            }
          />
        </div>
      </section>
    </div>
  );
}

function RecordTile({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className="text-sm font-semibold text-slate-900">
        {value ?? <span className="text-slate-400 font-normal">아직 없음</span>}
      </p>
    </div>
  );
}

function HeadToHeadPanel({
  participants,
  games,
  participantId,
}: {
  participants: ParticipantLite[];
  games: GameResult[];
  participantId: string;
}) {
  const entries = useMemo(
    () => computeHeadToHead(participants, games, participantId),
    [participants, games, participantId]
  );
  const name = participants.find((p) => p.id === participantId)?.name ?? "";

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5">
      <h2 className="font-semibold mb-1">{name}의 상대 전적</h2>
      <p className="text-xs text-slate-400 mb-4">
        위 기간·종목 필터가 그대로 적용됩니다. 게임의 Win/Lose로 이동한 점수만
        집계하며, 정산·기부는 포함하지 않습니다.
      </p>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-400">해당 기간에 상대 전적이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 text-xs">
                <th className="py-2 pr-4">상대</th>
                <th className="py-2 pr-4">딴 점수</th>
                <th className="py-2 pr-4">잃은 점수</th>
                <th className="py-2 pr-4">순점수</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const net = e.pointsWon - e.pointsLost;
                return (
                  <tr key={e.opponentId} className="border-t border-slate-100">
                    <td className="py-2 pr-4 font-medium">{e.opponentName}</td>
                    <td className="py-2 pr-4 text-emerald-600">{e.pointsWon}</td>
                    <td className="py-2 pr-4 text-red-500">{e.pointsLost}</td>
                    <td
                      className={`py-2 pr-4 font-semibold ${
                        net > 0
                          ? "text-emerald-600"
                          : net < 0
                          ? "text-red-500"
                          : "text-slate-400"
                      }`}
                    >
                      {net > 0 ? "+" : ""}
                      {net}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
