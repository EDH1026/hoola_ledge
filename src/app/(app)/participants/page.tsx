import { listParticipants } from "@/lib/storage";
import { addParticipant, renameParticipant, setParticipantActive } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function ParticipantsPage() {
  const all = await listParticipants();
  const participants = [...all].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const active = participants.filter((p) => p.active);
  const inactive = participants.filter((p) => !p.active);

  return (
    <div className="space-y-8">
      <div>
        <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 text-amber-300 text-xs font-medium px-2.5 py-1 mb-2">
          관리자 모드
        </div>
        <h1 className="text-2xl font-bold">참가자 풀</h1>
        <p className="text-sm text-slate-400 mt-1">
          게임에 참여할 수 있는 전체 인원을 관리합니다. 비활성화된 참가자는 새 게임
          선택 목록에 나타나지 않지만 과거 기록은 그대로 유지됩니다.
        </p>
      </div>

      <section className="bg-slate-900 rounded-2xl border border-slate-800 p-5">
        <h2 className="font-semibold mb-3">참가자 추가</h2>
        <form
          action={async (formData: FormData) => {
            "use server";
            await addParticipant(String(formData.get("name") ?? ""));
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            name="name"
            placeholder="이름"
            required
            className="bg-slate-900 flex-1 rounded-lg border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-100"
          />
          <button
            type="submit"
            className="rounded-lg bg-slate-100 text-slate-900 text-sm font-medium px-4 py-2 hover:bg-slate-300 transition"
          >
            추가
          </button>
        </form>
      </section>

      <section className="bg-slate-900 rounded-2xl border border-slate-800 p-5">
        <h2 className="font-semibold mb-3">활성 참가자 ({active.length}명)</h2>
        <ul className="divide-y divide-slate-800">
          {active.map((p) => (
            <ParticipantRow key={p.id} id={p.id} name={p.name} active={p.active} />
          ))}
          {active.length === 0 && (
            <p className="text-sm text-slate-500 py-2">참가자가 없습니다.</p>
          )}
        </ul>
      </section>

      {inactive.length > 0 && (
        <section className="bg-slate-900 rounded-2xl border border-slate-800 p-5">
          <h2 className="font-semibold mb-3 text-slate-400">
            비활성 참가자 ({inactive.length}명)
          </h2>
          <ul className="divide-y divide-slate-800">
            {inactive.map((p) => (
              <ParticipantRow key={p.id} id={p.id} name={p.name} active={p.active} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ParticipantRow({
  id,
  name,
  active,
}: {
  id: string;
  name: string;
  active: boolean;
}) {
  const toggleAction = setParticipantActive.bind(null, id, !active);

  return (
    <li className="py-2.5 flex items-center gap-3">
      <form
        action={async (formData: FormData) => {
          "use server";
          const newName = String(formData.get("name") ?? "");
          await renameParticipant(id, newName);
        }}
        className="flex-1 flex items-center gap-2"
      >
        <input
          type="text"
          name="name"
          defaultValue={name}
          className={`bg-slate-900 flex-1 rounded-lg border px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-100 ${
            active ? "border-slate-800" : "border-slate-800 text-slate-500"
          }`}
        />
        <button
          type="submit"
          className="text-xs text-slate-500 hover:text-slate-100 px-2"
        >
          저장
        </button>
      </form>
      <form action={toggleAction}>
        <button
          type="submit"
          className={`text-xs px-3 py-1.5 rounded-lg font-medium transition ${
            active
              ? "bg-slate-800 text-slate-300 hover:bg-red-500/20 hover:text-red-400"
              : "bg-slate-100 text-slate-900 hover:bg-slate-300"
          }`}
        >
          {active ? "비활성화" : "다시 활성화"}
        </button>
      </form>
    </li>
  );
}
