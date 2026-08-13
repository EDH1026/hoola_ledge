import { listParticipants } from "@/lib/storage";
import { getPreviousAttendeeIds } from "@/lib/actions";
import NewGameForm from "./NewGameForm";

export const dynamic = "force-dynamic";

export default async function NewGamePage() {
  const participants = await listParticipants();
  const activeParticipants = participants
    .filter((p) => p.active)
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const previousAttendeeIds = await getPreviousAttendeeIds();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">새 게임 기록</h1>
        <p className="text-sm text-slate-500 mt-1">
          종목과 참가자를 고르고, Lose를 Win에게 드래그하면 결과가 기록됩니다.
        </p>
      </div>

      {activeParticipants.length < 2 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 text-sm text-slate-500">
          먼저{" "}
          <a href="/participants" className="underline">
            참가자
          </a>
          를 2명 이상 등록해 주세요.
        </div>
      ) : (
        <NewGameForm
          participants={activeParticipants.map((p) => ({ id: p.id, name: p.name }))}
          defaultAttendeeIds={previousAttendeeIds}
        />
      )}
    </div>
  );
}
