import { getFullDB } from "@/lib/storage";
import RecordsClient from "./RecordsClient";

export const dynamic = "force-dynamic";

export default async function RecordsPage() {
  const { participants, games, settlements, adjustments } = await getFullDB();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">통산기록</h1>
        <p className="text-sm text-slate-400 mt-1">
          분기 티어, 최근 3개월 성향, 통산 명예의 전당을 확인할 수 있습니다.
        </p>
      </div>
      <RecordsClient
        participants={participants.map((p) => ({
          id: p.id,
          name: p.name,
          active: p.active,
        }))}
        games={games}
        settlements={settlements}
        adjustments={adjustments}
      />
    </div>
  );
}
