# 게임 장부 (hoola_ledge) — PRD v2.10

- 최초 작성: 2026-08-13 / 최종 개정: 2026-08-13 (v2.10)
- 저장소: https://github.com/EDH1026/hoola_ledge
- 배포: Vercel 프로젝트 `hoola` (도메인: `hoola-three.vercel.app`), 팀 `HYSNESTR`
- 문서의 목적: 현재 구현된 기능/구조를 정리하고, 다음 릴리스(v2.10)에서 고칠 버그와 추가할 기능을 확정하여 Claude Code 작업의 기준 문서로 사용

### 버전 이력

| 버전 | 내용 |
| --- | --- |
| v1.0 | 최초 구현 — 참가자 풀, 게임 기록(드래그 앤 드롭), 최소 거래 정산, 통계, 공유 비밀번호 인증, Vercel 배포 |
| v2.0 | 관리자 모드, 과거 누적기록, 게임 종목/시간 자동기록/점수/N차전, 게임 소프트 삭제, Win-Lose 용어 통일, 정산 카드 UI + 기부, 상대 전적, 기부 랭킹, 관리자 롤백 (§8, 구현 완료) |
| **v2.10** | **버그 수정 4건 + 정산 안전장치 + 구간별 인별 점수 합계 + 이스포츠 스타일 통계/대시보드 확장 (§9, 이번 작업 범위)** |

## 1. 제품 개요

매번 참석자가 달라지는 소규모 모임 게임(보드게임 등)에서, 각 게임의 결과를 기록하고 그로부터 발생하는 채권-채무 관계를 자동으로 정리해주는 웹 앱이다. 참가자 풀은 고정되어 있지만 게임마다 실제 참석자는 그중 일부로 달라진다. 접근은 팀 전체가 공유하는 비밀번호로 제한되며, 장부 정합성에 영향을 주는 기능은 별도의 관리자 비밀번호로 한 번 더 보호된다.

### 핵심 규칙

- 매 게임마다 전체 등수가 아니라 **Win(1위)과 Lose(최하위)만** 기록한다.
- **Lose가 Win에게 해당 게임의 점수를 지급**한다. 점수는 기본 1점이며 게임별로 다르게(예: 2점) 지정할 수 있다. 점수는 소정의 상품으로 교환 가능하다.
- 게임 결과 입력 UI는 Lose 참가자 카드를 Win 참가자 카드 위로 **드래그 앤 드롭**하는 방식이며, 확인 후 결과가 기록되고 채권-채무 장부가 갱신된다.
- 새 게임을 등록할 때 참석자 선택의 기본값은 **직전 게임의 참석자와 동일**하며, 필요 시 체크박스로 변경할 수 있다.
- 게임 날짜·시각은 사용자가 입력하지 않고 **기록하는 순간의 서버 시각(Asia/Seoul)이 그대로 저장**된다.
- 게임이 쌓이면 참가자 간에 다대다 채권-채무 관계가 형성되는데, 이를 **최소 거래 수**로 자동 간소화한다. (예: A가 B에게 2를 줄 것이 있고 B가 C에게 1을 줄 것이 있으면, A→B 1, A→C 1로 정리)
- 정산에는 실제 상품 교환인 **"실제 정산"**과, 임의의 두 사람 사이에서 자유롭게 점수를 넘겨주는 **"기부"** 두 종류가 있다.
- 기간별(일/주/월/년)·종목별 승/패 횟수와 순위를 여러 각도로 볼 수 있는 통계 화면을 제공한다.

## 2. 데이터 모델

파일: `src/lib/types.ts`

```ts
interface Participant {
  id: string;
  name: string;
  active: boolean;   // 비활성 참가자는 새 게임 선택 목록에서 제외되나 과거 기록은 유지
  createdAt: string;
}

type GameType = "hoola" | "citadels" | "6nimmt"; // 훌라 / 시타델 / 젝스님트

interface GameResult {
  id: string;
  date: string;           // yyyy-MM-dd, Asia/Seoul, 기록 시점에 서버가 설정 (사용자 입력 불가)
  time?: string;          // "HH:mm", Asia/Seoul. 이 필드 이전 레코드에는 없음
  gameType?: GameType;    // 이 필드 이전 레코드에는 없음
  points?: number;        // Win이 Lose에게서 가져가는 점수. 없으면 1로 간주
  active?: boolean;       // false = 소프트 삭제(잔액/통계/목록에서 제외). 없으면 true로 간주
  attendeeIds: string[];
  winnerId: string;       // Win (내부 필드명 유지)
  loserId: string;        // Lose (내부 필드명 유지)
  note?: string;
  createdAt: string;      // ISO datetime, 정렬 및 관리자 롤백 기준
}

// "waiver"는 예전 값을 계속 파싱하기 위해 남아있을 뿐, 새로 쓰는 값은 항상
// "payment" | "donation" — 읽을 때 normalizeSettlementType()으로 정규화한다.
type SettlementType = "payment" | "donation" | "waiver";

interface Settlement {
  id: string;
  type?: SettlementType; // 없으면 "payment"로 간주
  fromId: string;        // 주는 사람
  toId: string;          // 받는 사람
  amount: number;
  date: string;
  note?: string;
  createdAt: string;
}

interface LedgerAdjustment {   // 과거 누적기록 — 승패 없이 채무자→채권자, 금액만 존재
  id: string;
  fromId: string;  // 채무자
  toId: string;    // 채권자
  amount: number;
  note?: string;
  date: string;
  createdAt: string;
}

interface DB {
  participants: Participant[];
  games: GameResult[];
  settlements: Settlement[];
  adjustments: LedgerAdjustment[];
}
```

DB 전체가 하나의 JSON 문서로 저장되며, 4개 컬렉션 외의 구조는 없다 (관계형 정규화 없음, 매번 전체를 읽고 쓰는 방식). 옵셔널 필드들은 모두 마이그레이션 없이 기존 레코드를 읽을 수 있도록 설계되어 있다 — 없으면 위 주석의 기본값으로 처리된다. **앞으로 추가되는 필드도 동일한 원칙(옵셔널 + 안전한 기본값)을 따른다.**

## 3. 도메인 로직

### 3.1 잔액 계산 및 최소 거래 간소화 (`src/lib/settle.ts`)

`computeNetBalances(games, settlements, adjustments)`는 참가자별 순잔액을 계산한다. 양수 = 받을 것이 있음(채권자), 음수 = 줄 것이 있음(채무자). 소프트 삭제된 게임(`active === false`)은 내부에서 자동으로 제외된다.

부호 규칙:

| 이벤트 | fromId(주는 쪽) | toId(받는 쪽) | 비고 |
| --- | --- | --- | --- |
| 게임 | Lose `−points` | Win `+points` | 점수 없으면 1로 간주 |
| 실제 정산 (`payment`) | `+amount` | `−amount` | 빚을 갚아 양쪽 잔액이 0에 수렴 |
| **기부 (`donation`)** | **`−amount`** | **`+amount`** | **v2.10에서 방향 수정 — §9.1.2 참고** |
| 과거 누적기록 | 채무자 `−amount` | 채권자 `+amount` | 게임과 같은 방향 |

`simplifyDebts(balances)`는 잔액을 채무자/채권자로 나눠 각각 금액 내림차순 정렬 후 가장 큰 채무자와 가장 큰 채권자를 그리디하게 매칭한다(Splitwise류 앱의 표준 알고리즘). N명의 0이 아닌 잔액에 대해 최대 N−1개의 거래가 생성된다. 이 로직은 `scripts/verify-settle.ts`로 검증되어 있다.

### 3.2 통계 (`src/lib/stats.ts`)

- `computeParticipantStats`: 참가자별 승/패/참석 횟수, 승률, 순포인트(각 게임의 `points` 반영).
- `computeHeadToHead`: 특정 참가자의 상대별 딴 점수/잃은 점수. 3명 이상 참석한 게임이라도 점수 이동은 winner↔loser 사이에서만 발생한다는 점을 반영.
- `groupGamesByPeriod`: 일/주/월/년 단위 버킷팅.
- `filterByDatePreset`: 최근 7일/30일/90일/올해/전체 범위 필터 (`.date`를 가진 모든 레코드에 적용 가능 — 정산 필터에도 재사용).
- `filterGamesByType`: 종목 필터.
- 통계 화면(`StatsClient.tsx`)에서 이 함수들을 클라이언트에서 재사용해 필터를 즉시 반영한다.

### 3.3 시간/회차 (`src/lib/time.ts`, `src/lib/games.ts`)

- 게임 기록 시각은 Asia/Seoul 기준 벽시계로 서버에서 생성한다.
- "N차전"은 저장하지 않고 조회 시 계산한다 (같은 날짜의 게임을 시간순 정렬 후 순번 부여).
- `activeGames(games)`가 소프트 삭제 필터링을 담당한다.

## 4. 화면/기능 명세 (현재)

| 라우트 | 접근 | 설명 |
| --- | --- | --- |
| `/login` | 공개 | 공유 비밀번호 로그인 |
| `/admin-login` | 로그인 | 관리자 비밀번호 입력 → 관리자 세션 발급 |
| `/` (대시보드) | 로그인 | 리더보드, 간소화된 정산 미리보기, 최근 게임 |
| `/games/new` | 로그인 | 종목 선택 → 참석자 선택 → 드래그로 Win/Lose 지정 → 점수·메모 확인 후 기록 |
| `/games` | 로그인 | 게임 목록(종목/참석자/Win·Lose/점수/N차전), 기간 필터, 기간 내 점수 합계, 소프트 삭제 |
| `/settlements` | 로그인 | 간소화된 거래 카드, 실제 정산·기부 기록, 순잔액 표, 정산 이력(유형 필터) |
| `/stats` | 로그인 | 기간·그룹핑·종목 필터, 리더보드, 차트, 상대 전적, 기부 랭킹 |
| `/participants` | **관리자** | 참가자 추가/이름 변경/활성-비활성 |
| `/adjustments` | **관리자** | 과거 누적기록 입력/수정/삭제 |
| `/rollback` | **관리자** | 특정 시각 이후 기록 하드 삭제 |

인증: 모든 `(app)` 라우트는 `src/proxy.ts`에서 세션 쿠키(`gl_session`)를 검사하고, 관리자 전용 라우트는 관리자 쿠키(`ADMIN_COOKIE_NAME`)를 추가로 검사한다.

## 5. 아키텍처

### 5.1 스택

- Next.js 16.3.0 (App Router, Turbopack), React 19.2.8
- `proxy.ts` (Next 16의 middleware 대체 파일 컨벤션, Node.js 런타임 기본)
- React Server Components + Server Actions, 일부는 JSX 내부 인라인 서버 액션
- `@dnd-kit/core` — 드래그 앤 드롭 / `recharts` — 차트 / `@vercel/blob` — 프로덕션 저장소 / `date-fns` / `uuid` / `zod`
- Tailwind CSS v4

### 5.2 저장소 계층 (`src/lib/storage.ts`)

"관계형 DB 없이 파일로" 관리한다는 요구사항에 따라, 로컬/프로덕션에서 다른 백엔드를 쓰는 어댑터 구조다.

- 로컬 개발: `data/db.json` (임시 파일 쓰기 후 rename으로 원자성 보장)
- 프로덕션(Vercel): Vercel Blob(Private 접근 모드). `BLOB_READ_WRITE_TOKEN` 존재 여부로 자동 전환
- **모든 읽기/쓰기는 DB 전체 JSON 대상** — 부분 갱신이 아니라 매번 전체를 읽고 수정하고 다시 쓴다(`mutateDB`)
- 동시성 제어: 같은 프로세스 내 `mutateDB` 호출을 in-memory promise 체인으로 직렬화. 다중 인스턴스는 커버하지 않음(저트래픽 사적 용도 전제하의 의도적 트레이드오프)

### 5.3 페이지 렌더링

Cache Components가 아닌 기존 라우트-세그먼트 설정 모델을 사용하며, DB를 읽는 모든 `(app)/` 페이지에 `export const dynamic = "force-dynamic"`을 명시해 정적 프리렌더링을 막고 있다. 즉 모든 페이지가 매 요청마다 서버 렌더링되고 그때마다 DB 전체를 읽는다.

## 6. 배포 환경 및 트러블슈팅 기록

### 6.1 필수 환경변수

| 변수 | 설명 |
| --- | --- |
| `SITE_PASSWORD` | 앱 접속용 공유 비밀번호 |
| `ADMIN_PASSWORD` | 관리자 모드 비밀번호 |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob 스토어 연결 시 자동 생성 (Storage 탭 → Connect, "Add a read-write token env var" 체크 필요) |

환경변수를 추가/변경한 뒤에는 반드시 **Redeploy**해야 반영된다.

### 6.2 겪었던 문제와 해결

- **Private Blob 스토어 읽기 실패**: 초기 구현은 `access: "public"`으로 `put()`하고 raw `fetch()`로 읽었으나, Private 접근 모드 스토어에서 실패. `@vercel/blob`의 `get(pathname, { access: "private" })` API로 교체하여 해결.
- **사이트 전체 404 (`NOT_FOUND`, Runtime Logs에 요청 자체가 안 찍힘)**: 빌드가 항상 성공하고 로컬에서도 정상 동작했음에도 모든 URL에서 플랫폼 레벨 404 발생. 배포 실패가 반복되며 **Vercel 프로젝트 내부 라우팅 매니페스트가 손상**된 것으로 추정(Vercel 커뮤니티에 동일 사례 존재). **해결책은 같은 GitHub 저장소를 가리키는 새 Vercel 프로젝트를 만들어 import하는 것**. 재발 시 같은 방법으로 우회 가능.
- **재배포 누락으로 인한 ENOENT**: Blob 스토어 연결 직후 `BLOB_READ_WRITE_TOKEN`이 실행 중인 배포에 반영되지 않아 로컬 파일 쓰기를 시도하다 `ENOENT: ... mkdir '/var/task/data'` 실패. Redeploy로 해결.

## 7. 알려진 제약사항 / 성능 관련 잠재 이슈

- **매 요청마다 전체 DB JSON을 읽고 쓴다.** 기록이 많아질수록 요청당 지연과 Blob 트래픽 비용이 선형 증가. 부분 갱신·캐싱·실제 DB 전환이 향후 검토 대상.
- **모든 페이지가 `force-dynamic`이라 캐싱이 없다.**
- **통계 계산이 매 요청마다 전체 게임을 순회**하고, 클라이언트 필터 변경 시에도 전체 데이터셋을 다시 그룹핑한다(초기 payload도 함께 증가).
- **동시성 제어가 단일 프로세스 in-memory 큐에만 의존**한다.
- **드래그 컴포넌트가 마운트 후에만 DndContext를 렌더링**한다(하이드레이션 불일치 회피) — 초기 로드 시 약간의 레이아웃 시프트.

## 8. v2.0 요구사항 (구현 완료)

관리자 모드(`ADMIN_PASSWORD` + 별도 쿠키), 과거 누적기록 입력, 게임 종목·자동 시각 기록·점수·N차전, 게임 소프트 삭제, "1등/꼴찌"→"Win/Lose" 용어 통일, 정산 카드 UI + 탕감→기부 확장, 게임 목록 기간 필터, 참가자별 상대 전적, 기부 랭킹, 관리자 데이터 롤백. 상세 스펙은 v2.0 문서 이력 및 구현된 코드를 참조한다.

---

## 9. v2.10 요구사항 (이번 작업 범위)

### 9.1 버그 수정 (구현 완료)

#### 9.1.1 모바일에서 드래그 앤 드롭이 동작하지 않음 (구현 완료)

- 실제 원인: `TouchSensor`와 `PointerSensor`를 동시에 등록한 것 — 터치 시작 시 두 센서가 같은 이벤트를 두고 경쟁했다. `PointerSensor`는 Pointer Events API로 마우스/터치/펜을 모두 처리하므로 `TouchSensor`를 제거하고 `PointerSensor` 하나만 남겼다(dnd-kit이 권장하는 조합).
- `Chip`에 `touch-none`(= `touch-action: none`) 클래스를 추가해 터치 시작 시 브라우저의 기본 스크롤 제스처가 포인터 이벤트를 가로채지 않도록 했다.
- `DragOverlay`를 추가해 드래그 중 카드가 손가락/커서를 따라오도록 했다(드롭 대상 하이라이트는 유지).
- 대체 입력 수단으로 Lose 카드 탭 → Win 카드 탭 방식의 2탭 플로우를 추가했다(동일한 4단계 확인으로 이어짐).

- 증상: 랩탑(마우스)에서는 정상 동작하나 휴대폰(터치)에서는 드래그가 제대로 되지 않는다.
- 추정 원인: `NewGameForm.tsx`의 draggable 요소에 `touch-action` 스타일이 지정되어 있지 않아, 터치 시작 시 브라우저의 기본 스크롤 제스처가 포인터 이벤트를 가로챈다. dnd-kit이 문서에서 명시적으로 요구하는 설정이다. 추가로 `DragOverlay`가 없어 드래그 중 요소가 손가락을 따라오지 않아 사용자가 "안 되는 것"으로 인지하기도 쉽다.
- 요구사항:
  - 모바일 실기기(또는 브라우저 터치 에뮬레이션)에서 드래그로 Win/Lose 지정이 확실히 동작해야 한다.
  - 드래그 중 시각적 피드백(요소가 손가락을 따라오는 형태)이 있어야 한다.
  - **드래그가 실패하더라도 결과를 입력할 수 있는 대체 수단**을 제공한다 — 예: Lose 카드를 탭 → Win 카드를 탭하는 2탭 방식. 터치 환경에서의 안정성을 위한 보험이며, 드래그와 동일한 확인 단계로 이어진다.

#### 9.1.2 기부의 잔액 반영 방향이 반대 (구현 완료)

- `computeNetBalances`가 `normalizeSettlementType(s.type)`로 정규화한 뒤 분기하도록 수정: `payment`는 기존대로 `from += amount / to −= amount`, `donation`(레거시 `waiver` 포함)은 `from −= amount / to += amount`.
- 이 변경으로 기존에 저장된 기부/탕감 레코드의 잔액도 새 공식으로 재계산된다 — 의도된 동작.
- `scripts/verify-settle.ts`에 방향 검증 케이스(case 6, 10, 11)를 추가했고, 기부 랭킹/이력/잔액 표/간소화 거래 목록 모두 브라우저에서 직접 확인했다.

#### 9.1.3 관리자 전용 탭이 비관리자에게도 노출됨 (구현 완료)

- `AppLayout`의 `NAV_ITEMS`를 관리자가 아니면 `admin: true` 항목 자체를 배열에서 걸러내도록 수정(`.filter`). 자물쇠 아이콘과 `LockIcon` 컴포넌트는 더 이상 쓰이지 않아 제거했다.

#### 9.1.4 정산이 너무 쉽게, 크게 실행됨 (구현 완료)

- `/settlements`의 거래 카드·기부 폼을 client component(`SettlementsClient.tsx`)로 전환해 2단계 확인(입력 → 확인 및 기록)을 도입했다.
- 금액 입력은 기본값 없이 비워두고, "전액 (N점)" 버튼으로 명시적으로만 전액을 채울 수 있게 했다.
- 확인 단계에서 전액 정산이거나 5점 이상이면 경고 배너를 표시한다(임계값 5는 이 앱에서 게임 1판이 보통 1~2점이라는 점을 기준으로 한 판단).
- 기록 직후 "방금 기록됨 · 취소" 배너를 표시한다. 이 배너는 거래 카드 자체가 아니라 상위 `SettlementsClient`가 상태를 들고 있어, 정산으로 인해 해당 거래 카드가 목록에서 사라져도(정산이 완료되어 재계산됨) 취소 동선이 사라지지 않는다.
- `recordSettlement`가 생성된 레코드의 `id`를 반환하도록 수정해 취소 동선에서 바로 사용한다.

### 9.2 게임 목록 — 구간 내 인별 점수 합계 (구현 완료)

- `computeParticipantPointTotals(participants, games)`를 `src/lib/stats.ts`에 순수 함수로 추가했다. `/games`의 필터된 목록에서 딴 점수/잃은 점수/순점수를 순점수 내림차순으로 보여주는 "이 구간 인별 점수" 표를 필터 요약 바로 아래에 추가했다(`GamesListClient.tsx`).

### 9.3 이스포츠 스타일 통계/대시보드 확장 (구현 완료)

모임의 재미를 높이는 것이 목적이다. LoL 같은 이스포츠 서비스의 전적/랭킹 화면에서 쓰는 표현 방식을 참고한다.

#### 9.3.1 대시보드 (구현 완료)

- **핫 플레이어 / 콜드 플레이어**: `computeHotColdPlayers`가 "최근 14일" 창을 통산과 비교한다. 최소 표본 조건은 최근 14일간 3경기 이상(`HOT_COLD_MIN_RECENT_GAMES`) — 미달이면 해당 참가자는 비교 대상에서 제외된다. 화면과 코드 주석 모두에 이 기준을 명시했다.
- **최근 폼**: `computeRecentForm`이 최근 5개 승부(단순 참석은 애초에 승/패 집계 대상이 아니므로 자연히 제외됨)를 `ResultBadge`(W/L) 시퀀스로 반환한다.
- **현재 스트릭**: `computeCurrentStreaks` + `StreakBadge`.
- **오늘의 요약**: `computeTodaySummary`(Asia/Seoul "오늘" 기준) — 오늘 게임 수, 오늘의 최다 승자.

#### 9.3.2 통계 화면 (구현 완료)

- **티어/랭크 뱃지**: `computeTier(winRate, decisiveGames)` — 승률 기준 브론즈(&lt;35%)~챌린저(≥75%) 6단계 + 3경기 미만은 "랭크 미배정". 화면에 컷라인을 그대로 노출했다.
- **상대 전적 매트릭스**: `computeHeadToHeadMatrix` + 참가자×참가자 표, 셀 배경을 순점수 절댓값 비율로 초록/빨강 rgba 음영 처리(정적 Tailwind 클래스로는 표현 불가능해 인라인 style 사용).
- **천적 / 밥**: `computeNemesisAndVictim`(기존 `computeHeadToHead` 재사용).
- **종목별 성적**: `computeGameTypeStats` — 종목별 최강자에 "최강" 표시. 이 표는 페이지 상단의 종목 필터를 의도적으로 무시하고(종목 간 비교가 목적이므로) 기간 필터만 적용한다는 점을 화면에 명시했다.
- **기록실**: `computeRecords` — 최장 연승/연패, 단일 게임 최고 점수, 하루 최다 승리, 최다 참석. 페이지의 기간·종목 필터와 무관하게 항상 전체 `games`로 계산되며, 화면에 "통산 기준"임을 명시했다.

#### 9.3.3 구현 지침 (반영됨)

- 위 함수들은 모두 `src/lib/stats.ts`의 순수 함수이며, 내부에서 `activeGames()`로 소프트 삭제된 게임을 제외하고 `points ?? 1` 등 레거시 기본값을 동일하게 적용한다.
- 참가자 2~3명, 게임 0~수 건 등 소규모 데이터셋에서의 빈 상태를 실제 브라우저 세션으로 확인했다(모든 신규 섹션이 빈 배열/`null`을 받아도 안내 문구만 보여주고 깨지지 않음).

### 9.4 성공 기준 (모두 충족 확인됨)

- 휴대폰 브라우저에서 게임 결과 입력이 문제없이 완료된다. (터치 이벤트로 드래그를 재현해 실제 동작을 확인했고, 실기기 검증 방법은 별도로 안내했다.)
- 기부 기록 후 잔액이 "주는 사람 감소 / 받는 사람 증가" 방향으로 반영된다. (브라우저에서 직접 확인.)
- 비관리자 화면에 관리자 전용 탭이 보이지 않는다.
- 정산이 최소 두 번의 명시적 조작을 거쳐야 기록된다.
- `/games`에서 기간 필터 적용 시 인별 점수 합계가 보인다.
- 대시보드와 통계에 핫/콜드 플레이어를 포함한 신규 지표들이 표시되며, `npm run build`와 `npm run lint`가 통과한다.

## 10. 다음 단계

v2.10 구현은 이 문서를 기준으로 Claude Code 세션에서 진행한다. 구체적인 작업 지시는 `CLAUDE_CODE_PROMPT_V2_10.md`에 정리되어 있다.
