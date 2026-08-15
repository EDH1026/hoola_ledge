import Link from "next/link";
import { cookies } from "next/headers";
import { listParticipants, listGames } from "@/lib/storage";
import { activeGames, computeDailySequenceNumbers } from "@/lib/games";
import { ADMIN_COOKIE_NAME, verifyAdminCookie } from "@/lib/auth";
import { buttonClassName } from "@/components/ui/Button";
import GamesListClient from "./GamesListClient";

export const dynamic = "force-dynamic";

export default async function GamesPage() {
  const store = await cookies();
  const isAdmin = await verifyAdminCookie(store.get(ADMIN_COOKIE_NAME)?.value);

  const [participants, allGames] = await Promise.all([listParticipants(), listGames()]);
  const activeOnly = activeGames(allGames);
  // Admins get soft-deleted games too, so they can view/edit/reactivate them
  // (PRD 11) — everyone else keeps seeing only the active list as before.
  const games = isAdmin ? allGames : activeOnly;

  // Computed over ALL active games (not the filtered subset) so N차전 numbers
  // never shift just because a year/month/day filter is applied on top.
  const sequenceNumbers: Record<string, number> = {};
  for (const [id, seq] of computeDailySequenceNumbers(allGames)) {
    sequenceNumbers[id] = seq;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-content">게임 기록</h1>
          <p className="text-sm text-content-muted mt-1 tabular-nums">총 {activeOnly.length}회</p>
        </div>
        <Link href="/games/new" className={buttonClassName("primary")}>
          + 새 게임 기록
        </Link>
      </div>

      <GamesListClient
        games={games}
        participants={participants.map((p) => ({ id: p.id, name: p.name }))}
        sequenceNumbers={sequenceNumbers}
        isAdmin={isAdmin}
      />
    </div>
  );
}
