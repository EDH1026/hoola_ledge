import { ChevronDown } from "lucide-react";
import type { GameDayBoard, GameDayRow } from "@/lib/stats";
import { GAME_TYPE_LABELS } from "@/lib/types";
import { gameWallClock } from "@/lib/time";
import { StreakBadge, GameNightBadge, GameTypeBadge, GameDayStatusChip } from "@/components/badges";
import { Card } from "@/components/ui/Card";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { RefreshButton } from "@/components/ui/RefreshButton";

function nameFromBoard(board: GameDayBoard, id: string): string {
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

function subtitleText(board: GameDayBoard): string {
  const parts = board.countsByGameType.map(
    (c) => `${c.gameType ? GAME_TYPE_LABELS[c.gameType] : "종목 미지정"} ${c.count}`
  );
  return `${parts.join(" · ")} · 총 ${board.totalGames}판`;
}

function BoardRow({ row, rank }: { row: GameDayRow; rank: number }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className="w-5 shrink-0 text-content-faint">{rank}</span>
      <span className="font-medium text-content truncate">{row.name}</span>
      <span className="text-content-muted shrink-0">
        {row.wins}승 {row.losses}패
      </span>
      <span className={`text-sm font-semibold tabular-nums shrink-0 w-10 text-right ${netPointsClassName(row.netPoints)}`}>
        {row.netPoints > 0 ? "+" : ""}
        {row.netPoints}
      </span>
      <span className="shrink-0">
        {row.streakType === null ? (
          <span className="text-xs text-content-muted">아직 무승부</span>
        ) : row.streakLength >= 2 ? (
          <StreakBadge type={row.streakType} length={row.streakLength} />
        ) : null}
      </span>
    </li>
  );
}

/**
 * v2.21 (PRD §28.2) — 접이식 게임 상세. v2.20 대시보드의 "최근 게임" 카드
 * 마크업을 그대로 옮겨왔다(v2.19 배치 C에서 이미 정보 위계를 잡아둔
 * 부분이라 내용은 손대지 않음). 서버 컴포넌트인 이 카드 안에서 JS 없이
 * 접기/펼치기가 동작하도록 `<details>/<summary>`를 쓴다 — useState로
 * 만들면 이 파일 전체를 클라이언트 컴포넌트로 바꿔야 한다.
 */
function GameDetailsList({ board }: { board: GameDayBoard }) {
  return (
    <details className="mt-3 group">
      <summary className="min-h-11 flex items-center gap-1.5 cursor-pointer select-none list-none text-sm text-content-sub hover:text-content [&::-webkit-details-marker]:hidden">
        <ChevronDown
          className="w-4 h-4 shrink-0 transition-transform group-open:rotate-180"
          aria-hidden
        />
        <span className="group-open:hidden">게임 상세 {board.totalGames}판 보기</span>
        <span className="hidden group-open:inline">게임 상세 접기</span>
      </summary>
      <ul className="divide-y divide-line mt-1">
        {board.games.map(({ game: g, sequence }) => {
          const wallClock = gameWallClock(g.date, g.time);
          return (
            <li key={g.id} className="py-2.5 space-y-1 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <GameTypeBadge gameType={g.gameType} />
                  {wallClock.crossedMidnight && (
                    <GameNightBadge businessDate={wallClock.businessDate} />
                  )}
                  <span className="text-content-muted text-xs tabular-nums">
                    {sequence ? `${sequence}차전` : ""}
                    {g.time ? ` · ${g.time}` : ""}
                  </span>
                </div>
                <span className="text-content-muted text-xs tabular-nums">
                  참가 {g.attendeeIds.length}명
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="tabular-nums">
                  {/* 화살표는 점수가 흐르는 방향(패자 -> 승자)을 가리킨다. */}
                  <span className="text-lose font-medium">{nameFromBoard(board, g.loserId)}</span>
                  <span className="text-content-muted mx-1.5">→</span>
                  <span className="text-emerald-400 font-medium">
                    {nameFromBoard(board, g.winnerId)}
                  </span>
                </span>
                <span className="text-base font-semibold text-content tabular-nums shrink-0">
                  {g.points ?? 1}점
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/**
 * v2.21 (PRD §28.2) — v2.20의 GameNightBoardCard를 개편. 대상 경기일이
 * "오늘"이 아니라 "활성 게임이 있는 가장 최근 영업일"이므로 게임이 한
 * 판이라도 있으면 항상 렌더된다(board가 null일 때만 호출부가 아예
 * 렌더하지 않음). 별도 전체화면 라우트는 폐기했다.
 */
export function RecentGameDayCard({
  board,
  updatedAtLabel,
}: {
  board: GameDayBoard;
  updatedAtLabel: string;
}) {
  return (
    <Card>
      <SectionTitle
        description={subtitleText(board)}
        action={<RefreshButton updatedAtLabel={updatedAtLabel} />}
      >
        <span className="inline-flex items-center gap-2">
          최근 경기일 · {formatDateWithWeekday(board.date)}
          <GameDayStatusChip status={board.status} />
        </span>
      </SectionTitle>
      <ol className="mt-3 space-y-1.5 tabular-nums">
        {board.rows.map((row, i) => (
          <BoardRow key={row.id} row={row} rank={i + 1} />
        ))}
      </ol>
      <GameDetailsList board={board} />
    </Card>
  );
}
