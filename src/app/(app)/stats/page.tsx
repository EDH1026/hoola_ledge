import { listParticipants, listGames } from "@/lib/storage";
import StatsClient from "./StatsClient";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const [participants, games] = await Promise.all([listParticipants(), listGames()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-content">통계</h1>
        <p className="text-sm text-content-muted mt-1">
          기간을 바꿔가며 승/패 추이를 다양한 각도로 확인할 수 있습니다.
        </p>
      </div>
      <StatsClient
        participants={participants.map((p) => ({
          id: p.id,
          name: p.name,
          active: p.active,
        }))}
        games={games}
      />
    </div>
  );
}
