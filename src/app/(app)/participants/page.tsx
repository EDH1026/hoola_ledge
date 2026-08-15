import { listParticipants } from "@/lib/storage";
import { addParticipant, renameParticipant, setParticipantActive } from "@/lib/actions";
import { Card } from "@/components/ui/Card";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { EmptyState } from "@/components/ui/EmptyState";
import { SubmitButton } from "@/components/ui/SubmitButton";

export const dynamic = "force-dynamic";

export default async function ParticipantsPage() {
  const all = await listParticipants();
  const participants = [...all].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const active = participants.filter((p) => p.active);
  const inactive = participants.filter((p) => !p.active);

  return (
    <div className="space-y-6">
      <div>
        <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 text-amber-300 text-xs font-medium px-2.5 py-1 mb-2">
          관리자 모드
        </div>
        <h1 className="text-2xl font-bold text-content">참가자 풀</h1>
        <p className="text-sm text-content-muted mt-1">
          게임에 참여할 수 있는 전체 인원을 관리합니다. 비활성화된 참가자는 새 게임
          선택 목록에 나타나지 않지만 과거 기록은 그대로 유지됩니다.
        </p>
      </div>

      <Card>
        <SectionTitle>참가자 추가</SectionTitle>
        <form
          action={async (formData: FormData) => {
            "use server";
            await addParticipant(String(formData.get("name") ?? ""));
          }}
          className="flex gap-2 mt-3"
        >
          <input
            type="text"
            name="name"
            placeholder="이름"
            required
            className="bg-surface flex-1 rounded-lg border border-slate-700 px-3 py-2 text-sm text-content focus:outline-none focus:ring-2 focus:ring-accent-soft"
          />
          <SubmitButton pendingText="추가 중...">추가</SubmitButton>
        </form>
      </Card>

      <Card>
        <SectionTitle>활성 참가자 ({active.length}명)</SectionTitle>
        <ul className="divide-y divide-line mt-3">
          {active.map((p) => (
            <ParticipantRow key={p.id} id={p.id} name={p.name} active={p.active} />
          ))}
        </ul>
        {active.length === 0 && (
          <div className="pt-3">
            <EmptyState title="참가자가 없습니다." />
          </div>
        )}
      </Card>

      {inactive.length > 0 && (
        <Card>
          <SectionTitle>
            <span className="text-content-muted">비활성 참가자 ({inactive.length}명)</span>
          </SectionTitle>
          <ul className="divide-y divide-line mt-3">
            {inactive.map((p) => (
              <ParticipantRow key={p.id} id={p.id} name={p.name} active={p.active} />
            ))}
          </ul>
        </Card>
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
          className="bg-surface flex-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-sm text-content-sub focus:outline-none focus:ring-2 focus:ring-accent-soft"
        />
        <SubmitButton variant="ghost" size="sm" pendingText="저장 중...">
          저장
        </SubmitButton>
      </form>
      <form action={toggleAction}>
        <SubmitButton
          variant={active ? "danger" : "neutral"}
          size="sm"
          pendingText={active ? "비활성화 중..." : "활성화 중..."}
        >
          {active ? "비활성화" : "다시 활성화"}
        </SubmitButton>
      </form>
    </li>
  );
}
