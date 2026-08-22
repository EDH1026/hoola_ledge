import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { SectionTitle } from "@/components/ui/SectionTitle";

interface ReductionAction {
  action: string;
  basis: string;
}

interface ReductionCategory {
  title: string;
  actions: ReductionAction[];
}

// PRD §34.5 — 1점 = 10kg 기준. 계수는 국내 평균 기준 근사치이며 공식
// 산정값이 아니다(면책 문구 참고). 화면 순서는 PRD 표 순서를 그대로 따른다.
// v2.24 (§34.5) — "안 사기"·"참기"만으로 충족되는 항목은 넣지 않는다.
// 전부 몸을 써서 실제로 수행하는 행동이어야 한다.
const REDUCTION_CATEGORIES: ReductionCategory[] = [
  {
    title: "호흡",
    actions: [
      { action: "24시간 숨 참기", basis: "성인 호흡 배출 ≈ 1kg/일 — 나머지 9kg은 정신력으로 인정" },
    ],
  },
  {
    title: "이동 (직접 움직이기)",
    actions: [
      { action: "자동차 대신 62km 걷기", basis: "승용차 1km ≈ 0.16kg" },
      { action: "왕복 20km 자전거 출퇴근 3일", basis: "위와 동일" },
      { action: "왕복 5km 장보기를 자전거로 7회", basis: "위와 동일" },
      { action: "엘리베이터 대신 계단 누적 500층", basis: "승강기 운행 전력 기준" },
      { action: "국내선 비행기 대신 KTX·버스로 1회 이동", basis: "김포–제주 편도 ≈ 100kg → 10점" },
    ],
  },
  {
    title: "몸으로 만들기",
    actions: [
      { action: "자전거 발전기로 22kWh 생산", basis: "지속 출력 100W 기준 약 220시간 · 배출계수 0.459kg/kWh" },
    ],
  },
  {
    title: "손으로 하기",
    actions: [
      { action: "건조기 대신 손으로 널고 걷기 7회", basis: "세탁기 1회분(약 5kg) 건조 기준, 회당 3kWh ≈ 1.38kg" },
      { action: "식기세척기 대신 손설거지 22회", basis: "한 끼 분량 기준, 회당 1kWh ≈ 0.46kg" },
      { action: "찬물로 손빨래 17회", basis: "세탁기 1회분(약 5kg) 세탁물 기준, 회당 ≈ 0.6kg 절감" },
      { action: "배달 대신 직접 걸어가 포장 픽업 20회", basis: "1회 배송·포장 ≈ 0.5kg" },
      { action: "청바지 1벌 직접 수선해 되살리기", basis: "신품 생산 ≈ 29kg → 약 3점" },
    ],
  },
  {
    title: "물",
    actions: [
      { action: "온수 대신 냉수 샤워 6회", basis: "10분 온수 샤워 ≈ 1.8kg" },
      { action: "자동세차 대신 손세차 7회", basis: "자동세차 1회 대비 손세차 절감 ≈ 1.5kg (온수 가열·건조 전력 기준)" },
    ],
  },
  {
    title: "장기",
    actions: [
      {
        action: "서울마이트리(seoulmytree.forest.or.kr)에서 나무 10그루 후원하기",
        basis: "그루당 30년생 소나무 연간 흡수 추정 ≈ 6.6kg 참고 (정확한 산정은 사이트 확인)",
      },
    ],
  },
];

export default function PrinciplesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-content">운영원칙</h1>
        <p className="text-sm text-content-muted mt-1">
          이 앱의 점수는 탄소배출권입니다. 게임을 하면 배출권이 오가고,
          보유량이 마이너스가 되면 실제 감축 행동으로 채워 넣어야 합니다.
        </p>
      </div>

      <Card className="text-center py-6 sm:py-8">
        <p className="text-xs text-content-muted mb-2">환산 규칙</p>
        <p className="text-3xl sm:text-4xl font-bold text-content tabular-nums">
          1점 = 10kg CO₂e
        </p>
        <p className="text-sm text-content-muted mt-1">배출권</p>
      </Card>

      <Card>
        <SectionTitle>의무 발생</SectionTitle>
        <p className="text-sm text-content mt-3">
          게임에서 진 사람은 이긴 사람에게 해당 수량의 배출권을 넘깁니다.
        </p>
      </Card>

      <Card>
        <SectionTitle description="사진·기록·영수증 등으로 인증하면 해당 수량을 확보한 것으로 봅니다.">
          부족 시 확보 방법
        </SectionTitle>
        <p className="text-sm text-content mt-3">
          보유량이 마이너스면 아래 감축 행동을 실제로 수행하고 인증해
          배출권을 확보해야 합니다.
        </p>
      </Card>

      <Card>
        <SectionTitle description="전부 1점 = 10kg 기준입니다.">감축 행동 목록</SectionTitle>
        <div className="space-y-5 mt-4">
          {REDUCTION_CATEGORIES.map((category) => (
            <div key={category.title}>
              <h3 className="text-sm font-semibold text-content-sub mb-2">
                {category.title}
              </h3>
              <ul className="space-y-2">
                {category.actions.map((item) => (
                  <li
                    key={item.action}
                    className="rounded-lg bg-surface-raised px-3 py-2"
                  >
                    <p className="text-sm text-content">{item.action}</p>
                    {item.basis && (
                      <p className="text-xs text-content-muted mt-0.5">{item.basis}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle>인증 규칙</SectionTitle>
        <p className="text-sm text-content mt-3">
          사진·기록·영수증 등으로 인증하면 해당 수량을 확보한 것으로 보고,{" "}
          <Link href="/settlements" className="underline">
            배출권
          </Link>{" "}
          화면에서 이전 처리합니다.
        </p>
      </Card>

      <p className="text-xs text-content-muted text-center">
        위 계수는 국내 평균 기준 근사치이며 공식 산정값이 아닙니다.
      </p>
    </div>
  );
}
