import Link from "next/link";
import { Maximize2 } from "lucide-react";
import type { GameNightBoard as GameNightBoardData, GameNightRow } from "@/lib/stats";
import { GAME_TYPE_LABELS } from "@/lib/types";
import { gameWallClock } from "@/lib/time";
import { StreakBadge, GameNightBadge } from "@/components/badges";
import { Card } from "@/components/ui/Card";
import { SectionTitle } from "@/components/ui/SectionTitle";

// v2.20 (PRD §26) — 대시보드 카드와 /tonight 전체화면 두 크기가 행 렌더링을
// 공유하고 타이포 스케일만 갈아끼운다. 헤더/부제는 SectionTitle이 이미
// 18px로 고정하므로 card 크기에서만 쓰고, full 크기는 SectionTitle 없이
// 훨씬 큰 자체 마크업을 쓴다 — "1~2미터 떨어져서도 읽히게"가 목적이라
// SectionTitle의 18px 고정 스케일로는 애초에 목적을 못 이룬다.
const ROW_SCALE = {
  card: {
    list: "mt-3 space-y-1.5 tabular-nums",
    row: "flex items-center gap-2 text-sm",
    rank: "w-5 shrink-0 text-content-faint",
    name: "font-medium text-content truncate",
    record: "text-content-muted shrink-0",
    net: "text-sm font-semibold tabular-nums shrink-0 w-10 text-right",
  },
  full: {
    list: "mt-6 space-y-3 tabular-nums",
    row: "flex items-center gap-3 sm:gap-4 text-2xl sm:text-3xl",
    rank: "w-8 sm:w-10 shrink-0 text-content-faint",
    name: "font-semibold text-content truncate",
    record: "text-content-muted text-lg sm:text-2xl shrink-0",
    net: "font-bold tabular-nums shrink-0 w-20 sm:w-24 text-right",
  },
} as const;

const FOOTER_SCALE = {
  card: "mt-3 pt-3 border-t border-line text-xs text-content-muted flex flex-wrap items-center gap-x-1.5 gap-y-1",
  full: "mt-6 pt-4 border-t border-line text-base sm:text-lg text-content-muted flex flex-wrap items-center gap-x-2 gap-y-1",
} as const;

type BoardSize = "card" | "full";

function nameFromBoard(board: GameNightBoardData, id: string): string {
  return board.rows.find((r) => r.id === id)?.name ?? "(삭제된 참가자)";
}

/** 순점수: 양수는 win 색, 음수는 lose 색, 0은 중립 — `> 0 ? win : lose` 두 갈래로 가르면 0이 빨간색으로 나온다. */
function netPointsClassName(net: number): string {
  if (net > 0) return "text-win";
  if (net < 0) return "text-lose";
  return "text-content-muted";
}

function formatDateWithWeekday(date: string): string {
  const WEEKDAY_LABELS_KO = ["일", "월", "화", "수", "목", "금", "토"];
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  // v2.19 GamesListClient/page.tsx와 같은 이유로 UTC 파싱을 쓴다 — 보는
  // 사람의 브라우저 타임존과 무관하게 요일이 고정된다.
  const weekday = WEEKDAY_LABELS_KO[new Date(date).getUTCDay()];
  return `${month}/${day} (${weekday})`;
}

function subtitleText(board: GameNightBoardData): string {
  const parts = board.countsByGameType.map(
    (c) => `${c.gameType ? GAME_TYPE_LABELS[c.gameType] : "종목 미지정"} ${c.count}`
  );
  return `${parts.join(" · ")} · 총 ${board.totalGames}판`;
}

function BoardRow({ row, rank, size }: { row: GameNightRow; rank: number; size: BoardSize }) {
  const scale = ROW_SCALE[size];
  return (
    <li className={scale.row}>
      <span className={scale.rank}>{rank}</span>
      <span className={scale.name}>{row.name}</span>
      <span className={scale.record}>
        {row.wins}승 {row.losses}패
      </span>
      <span className={`${scale.net} ${netPointsClassName(row.netPoints)}`}>
        {row.netPoints > 0 ? "+" : ""}
        {row.netPoints}
      </span>
      <span className="shrink-0">
        {row.streakType === null ? (
          <span className={size === "full" ? "text-lg sm:text-xl text-content-muted" : "text-xs text-content-muted"}>
            아직 무승부
          </span>
        ) : row.streakLength >= 2 ? (
          <StreakBadge type={row.streakType} length={row.streakLength} />
        ) : null}
      </span>
    </li>
  );
}

function BoardFooter({ board, size }: { board: GameNightBoardData; size: BoardSize }) {
  if (!board.latestGame) return null;
  const g = board.latestGame;
  const wallClock = gameWallClock(g.date, g.time);
  const points = g.points ?? 1;
  // 정산 화면·게임 목록과 같은 방향 관례 — 화살표는 점수가 흐르는 방향
  // (패자 -> 승자)을 가리킨다.
  const loserName = nameFromBoard(board, g.loserId);
  const winnerName = nameFromBoard(board, g.winnerId);

  return (
    <p className={FOOTER_SCALE[size]}>
      <span>
        방금 {board.latestSequence ? `${board.latestSequence}차전` : "게임"}
        {wallClock.time ? ` · ${wallClock.time}` : ""} ·{" "}
        <span className="text-lose font-medium">{loserName}</span>
        <span className="mx-1">→</span>
        <span className="text-win font-medium">{winnerName}</span> {points}점
      </span>
      {wallClock.crossedMidnight && <GameNightBadge businessDate={wallClock.businessDate} />}
    </p>
  );
}

function BoardRows({ board, size }: { board: GameNightBoardData; size: BoardSize }) {
  return (
    <ol className={ROW_SCALE[size].list}>
      {board.rows.map((row, i) => (
        <BoardRow key={row.id} row={row} rank={i + 1} size={size} />
      ))}
    </ol>
  );
}

/** 대시보드 최상단용 카드 크기. 게임 밤이 아닌 날은 호출부가 애초에 렌더하지 않는다(board가 null이면 아무것도 그리지 않음 — PRD §26.2). */
export function GameNightBoardCard({ board }: { board: GameNightBoardData }) {
  return (
    <Card>
      <SectionTitle
        description={subtitleText(board)}
        action={
          <Link
            href="/tonight"
            className="inline-flex items-center gap-1 text-xs text-content-muted hover:text-content hover:underline"
          >
            전체화면
            <Maximize2 className="w-3.5 h-3.5" aria-hidden />
          </Link>
        }
      >
        오늘의 게임밤 · {formatDateWithWeekday(board.date)}
      </SectionTitle>
      <BoardRows board={board} size="card" />
      <BoardFooter board={board} size="card" />
    </Card>
  );
}

/** /tonight 전체화면용 — 테이블 가운데 놓인 폰에서 1~2미터 떨어져도 읽히는 타이포. */
export function GameNightBoardFull({ board }: { board: GameNightBoardData }) {
  return (
    <div>
      <h1 className="text-3xl sm:text-4xl font-bold text-content">
        오늘의 게임밤 · {formatDateWithWeekday(board.date)}
      </h1>
      <p className="text-lg sm:text-xl text-content-muted mt-1">{subtitleText(board)}</p>
      <BoardRows board={board} size="full" />
      <BoardFooter board={board} size="full" />
    </div>
  );
}
