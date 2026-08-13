import RollbackForm from "./RollbackForm";

export const dynamic = "force-dynamic";

export default function RollbackPage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium px-2.5 py-1 mb-2">
          관리자 모드
        </div>
        <h1 className="text-2xl font-bold">데이터 롤백</h1>
        <p className="text-sm text-slate-500 mt-1">
          지정한 시각 이후에 생성된 게임·정산·과거 누적기록을 완전히(하드)
          삭제합니다. 참가자 풀 정보는 대상에서 제외됩니다.
        </p>
      </div>
      <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
        되돌릴 수 없는 작업입니다. 실행 전 삭제될 대상을 반드시 미리보기로
        확인하세요.
      </div>
      <RollbackForm />
    </div>
  );
}
