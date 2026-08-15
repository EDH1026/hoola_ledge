import { listParticipants, listGames } from "@/lib/storage";
import { getPreviousAttendeeIds } from "@/lib/actions";
import { activeGames, withinDayKey } from "@/lib/games";
import { Card } from "@/components/ui/Card";
import NewGameForm from "./NewGameForm";

export const dynamic = "force-dynamic";

export default async function NewGamePage() {
  const [participants, allGames] = await Promise.all([listParticipants(), listGames()]);
  const activeParticipants = participants
    .filter((p) => p.active)
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const previousAttendeeIds = await getPreviousAttendeeIds();

  // v2.19 (배치 B, PRD §24.9) — 종목 기본값 = 직전 게임의 종목. "가장 최근"의
  // 판정은 GamesListClient의 목록 정렬과 동일하게 date 내림차순 → 같은 날이면
  // withinDayKey 내림차순으로(자정을 넘긴 게임 밤도 실제 진행 순서를 지킨다).
  // created_at 순서로 고르지 않는 이유: 관리자가 나중에 날짜·시간을 고친
  // 기록이 있으면 두 순서가 어긋날 수 있다.
  const mostRecentGame = [...activeGames(allGames)].sort((a, b) =>
    b.date === a.date
      ? withinDayKey(b).localeCompare(withinDayKey(a))
      : b.date.localeCompare(a.date)
  )[0];
  const defaultGameType = mostRecentGame?.gameType ?? "hoola";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-content">새 게임 기록</h1>
        <p className="text-sm text-content-muted mt-1">
          종목과 참가자를 고르고, Lose를 Win에게 드래그하면 결과가 기록됩니다.
        </p>
      </div>

      {activeParticipants.length < 2 ? (
        <Card className="text-sm text-content-muted">
          먼저{" "}
          <a href="/participants" className="underline">
            참가자
          </a>
          를 2명 이상 등록해 주세요.
        </Card>
      ) : (
        <NewGameForm
          participants={activeParticipants.map((p) => ({ id: p.id, name: p.name }))}
          defaultAttendeeIds={previousAttendeeIds}
          defaultGameType={defaultGameType}
        />
      )}
    </div>
  );
}
