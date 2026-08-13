# 게임 장부 (hoola_ledge) — PRD v2.11

- 최초 작성: 2026-08-13 / 최종 개정: 2026-08-13 (v2.11)
- 저장소: https://github.com/EDH1026/hoola_ledge
- 배포: Vercel 프로젝트 `hoola` (도메인: `hoola-three.vercel.app`), 팀 `HYSNESTR`
- 문서의 목적: 현재 구현된 기능/구조를 정리하고, 다음 릴리스(v2.11 — 저장소를 Supabase로 전환)의 범위를 확정하여 Claude Code 작업의 기준 문서로 사용

### 버전 이력

| 버전 | 내용 |
| --- | --- |
| v1.0 | 최초 구현 — 참가자 풀, 게임 기록(드래그 앤 드롭), 최소 거래 정산, 통계, 공유 비밀번호 인증, Vercel 배포 |
| v2.0 | 관리자 모드, 과거 누적기록, 게임 종목/시간 자동기록/점수/N차전, 게임 소프트 삭제, Win-Lose 용어 통일, 정산 카드 UI + 기부, 상대 전적, 기부 랭킹, 관리자 롤백 (구현 완료) |
| v2.10 | 버그 수정(모바일 드래그, 기부 방향, 관리자 탭 노출, 정산 안전장치) + 게임 구간별 인별 점수 합계 + 이스포츠 스타일 통계/대시보드 확장 (구현 완료) |
| **v2.11** | **저장소를 Vercel Blob(JSON 파일)에서 Supabase(Postgres)로 전환 — §10, 이번 작업 범위** |

## 1. 제품 개요

매번 참석자가 달라지는 소규모 모임 게임(보드게임 등)에서, 각 게임의 결과를 기록하고 그로부터 발생하는 채권-채무 관계를 자동으로 정리해주는 웹 앱이다. 참가자 풀은 고정되어 있지만 게임마다 실제 참석자는 그중 일부로 달라진다. 접근은 팀 전체가 공유하는 비밀번호로 제한되며, 장부 정합성에 영향을 주는 기능은 별도의 관리자 비밀번호로 한 번 더 보호된다.

### 핵심 규칙

- 매 게임마다 전체 등수가 아니라 **Win(1위)과 Lose(최하위)만** 기록한다.
- **Lose가 Win에게 해당 게임의 점수를 지급**한다. 점수는 기본 1점이며 게임별로 다르게(예: 2점) 지정할 수 있다. 점수는 소정의 상품으로 교환 가능하다.
- 게임 결과 입력 UI는 Lose 참가자 카드를 Win 참가자 카드 위로 **드래그 앤 드롭**(또는 탭-투-탭)하는 방식이며, 확인 후 결과가 기록되고 채권-채무 장부가 갱신된다.
- 새 게임을 등록할 때 참석자 선택의 기본값은 **직전 게임의 참석자와 동일**하며, 필요 시 체크박스로 변경할 수 있다.
- 게임 날짜·시각은 사용자가 입력하지 않고 **기록하는 순간의 서버 시각(Asia/Seoul)이 그대로 저장**된다.
- 게임이 쌓이면 참가자 간에 다대다 채권-채무 관계가 형성되는데, 이를 **최소 거래 수**로 자동 간소화한다.
- 정산에는 실제 상품 교환인 **"실제 정산"**과, 임의의 두 사람 사이에서 자유롭게 점수를 넘겨주는 **"기부"** 두 종류가 있다. 기부하는 사람의 잔액은 감소하고 받는 사람의 잔액은 증가한다.
- 기간별(일/주/월/년)·종목별 승/패 횟수와 순위, 상대 전적, 티어, 기록실 등을 여러 각도로 볼 수 있는 통계·대시보드를 제공한다.
- 참가자 풀 관리, 과거 누적기록 입력, 데이터 롤백은 관리자 모드에서만 접근 가능하며 일반 화면에는 노출되지 않는다.

## 2. 데이터 모델 (v2.10 기준, 애플리케이션 타입)

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
  fromId: string;        // 주는 사람 (기부는 잔액 -amount, 실제 정산은 +amount)
  toId: string;          // 받는 사람 (기부는 잔액 +amount, 실제 정산은 -amount)
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

이 인터페이스들은 v2.11 이후에도 **애플리케이션 레이어의 타입으로는 그대로 유지**된다. 바뀌는 것은 이 타입들이 어디에 저장되는가(§5.2, §10)이지, 앱 코드가 다루는 모양이 아니다. 옵셔널 필드들은 마이그레이션 없이 기존 레코드를 읽을 수 있도록 설계되어 있다 — 없으면 위 주석의 기본값으로 처리된다.

## 3. 도메인 로직

### 3.1 잔액 계산 및 최소 거래 간소화 (`src/lib/settle.ts`)

`computeNetBalances(games, settlements, adjustments)`는 참가자별 순잔액을 계산한다. 양수 = 받을 것이 있음(채권자), 음수 = 줄 것이 있음(채무자). 소프트 삭제된 게임(`active === false`)은 내부에서 자동으로 제외된다.

부호 규칙:

| 이벤트 | fromId(주는 쪽) | toId(받는 쪽) | 비고 |
| --- | --- | --- | --- |
| 게임 | Lose `−points` | Win `+points` | 점수 없으면 1로 간주 |
| 실제 정산 (`payment`) | `+amount` | `−amount` | 빚을 갚아 양쪽 잔액이 0에 수렴 |
| 기부 (`donation`, 레거시 `waiver` 포함) | `−amount` | `+amount` | 점수를 그냥 넘겨주는 것 — 게임과 같은 방향 (v2.10에서 수정됨) |
| 과거 누적기록 | 채무자 `−amount` | 채권자 `+amount` | 게임과 같은 방향 |

`simplifyDebts(balances)`는 잔액을 채무자/채권자로 나눠 각각 금액 내림차순 정렬 후 가장 큰 채무자와 가장 큰 채권자를 그리디하게 매칭한다(Splitwise류 앱의 표준 알고리즘). N명의 0이 아닌 잔액에 대해 최대 N−1개의 거래가 생성된다. 이 로직은 `scripts/verify-settle.ts`로 검증되어 있다.

### 3.2 통계 (`src/lib/stats.ts`)

- `computeParticipantStats`: 참가자별 승/패/참석 횟수, 승률, 순포인트.
- `computeHeadToHead`: 특정 참가자의 상대별 딴 점수/잃은 점수 (winner↔loser 사이에서만 점수 이동).
- `groupGamesByPeriod`, `filterByDatePreset`, `filterGamesByType`: 기간·종목 필터링/그룹핑.
- v2.10에서 핫/콜드 플레이어, 최근 폼, 스트릭, 티어, 상대 전적 매트릭스, 천적/밥, 종목별 성적, 기록실 등 이스포츠 스타일 통계가 추가되었다. 모두 순수 함수로 구현되어 서버/클라이언트 양쪽에서 재사용된다.

### 3.3 시간/회차 (`src/lib/time.ts`, `src/lib/games.ts`)

- 게임 기록 시각은 Asia/Seoul 기준 벽시계로 서버에서 생성한다.
- "N차전"은 저장하지 않고 조회 시 계산한다.
- `activeGames(games)`가 소프트 삭제 필터링을 담당한다.

## 4. 화면/기능 명세

| 라우트 | 접근 | 설명 |
| --- | --- | --- |
| `/login` | 공개 | 공유 비밀번호 로그인 |
| `/admin-login` | 로그인 | 관리자 비밀번호 입력 → 관리자 세션 발급 |
| `/` (대시보드) | 로그인 | 리더보드, 정산 미리보기, 최근 게임, 핫/콜드 플레이어, 최근 폼, 스트릭, 오늘의 요약 |
| `/games/new` | 로그인 | 종목 선택 → 참석자 선택 → 드래그(또는 탭-투-탭)로 Win/Lose 지정 → 점수·메모 확인 후 기록 |
| `/games` | 로그인 | 게임 목록, 기간 필터, 기간 내 전체·인별 점수 합계, 소프트 삭제 |
| `/settlements` | 로그인 | 간소화된 거래 카드(2단계 확인), 실제 정산·기부 기록, 순잔액 표, 정산 이력(유형 필터) |
| `/stats` | 로그인 | 기간·그룹핑·종목 필터, 리더보드, 차트, 상대 전적 매트릭스, 천적/밥, 종목별 성적, 기록실 |
| `/participants` | **관리자** | 참가자 추가/이름 변경/활성-비활성 |
| `/adjustments` | **관리자** | 과거 누적기록 입력/수정/삭제 |
| `/rollback` | **관리자** | 특정 시각 이후 기록 하드 삭제 |

관리자 전용 라우트는 비관리자 상태에서 상단 네비게이션에 노출되지 않는다. 인증: 모든 `(app)` 라우트는 `src/proxy.ts`에서 세션 쿠키(`gl_session`)를 검사하고, 관리자 전용 라우트는 관리자 쿠키를 추가로 검사한다.

## 5. 아키텍처

### 5.1 스택

- Next.js 16.3.0 (App Router, Turbopack), React 19.2.8
- `proxy.ts` (Next 16의 middleware 대체 파일 컨벤션, Node.js 런타임 기본)
- React Server Components + Server Actions
- `@dnd-kit/core` — 드래그 앤 드롭 / `recharts` — 차트 / `date-fns` / `uuid` / `zod`
- Tailwind CSS v4
- **저장소: v2.10까지는 Vercel Blob, v2.11부터 Supabase(Postgres) — 아래 5.2, §10 참고**

### 5.2 저장소 계층 — 현재(v2.10, 전환 예정) 상태

> 이 절은 v2.11 마이그레이션 전까지의 현재 동작을 설명한다. v2.11 완료 후에는 §10의 내용으로 대체된다.

`src/lib/storage.ts`가 로컬 개발과 프로덕션에서 서로 다른 백엔드를 쓰는 어댑터 구조였다.

- 로컬 개발: `data/db.json` (임시 파일 쓰기 후 rename으로 원자성 보장)
- 프로덕션(Vercel): Vercel Blob(Private 접근 모드). `BLOB_READ_WRITE_TOKEN` 존재 여부로 자동 전환
- **모든 읽기/쓰기는 DB 전체 JSON 대상** — 부분 갱신이 아니라 매번 전체를 읽고 수정하고 다시 쓴다(`mutateDB`)
- 동시성 제어: 같은 프로세스 내 `mutateDB` 호출을 in-memory promise 체인으로 직렬화. 다중 인스턴스는 커버하지 않음

이 구조가 안고 있던 문제(§7에 기록됨 — 매 요청 전체 read/write, 캐싱 부재, 다중 인스턴스 동시성 미보장)를 해결하기 위해 v2.11에서 Supabase로 전환한다.

### 5.3 페이지 렌더링

Cache Components가 아닌 기존 라우트-세그먼트 설정 모델을 사용하며, DB를 읽는 모든 `(app)/` 페이지에 `export const dynamic = "force-dynamic"`을 명시해 정적 프리렌더링을 막고 있다.

## 6. 배포 환경 및 트러블슈팅 기록

### 6.1 필수 환경변수 (v2.10 기준)

| 변수 | 설명 |
| --- | --- |
| `SITE_PASSWORD` | 앱 접속용 공유 비밀번호 |
| `ADMIN_PASSWORD` | 관리자 모드 비밀번호 |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob 스토어 연결용. **v2.11 마이그레이션 완료 후 제거 예정** — §10.6 참고 |

환경변수를 추가/변경한 뒤에는 반드시 **Redeploy**해야 반영된다.

### 6.2 겪었던 문제와 해결

- **Private Blob 스토어 읽기 실패**: 초기 구현은 `access: "public"`으로 `put()`하고 raw `fetch()`로 읽었으나, Private 접근 모드 스토어에서 실패. `@vercel/blob`의 `get(pathname, { access: "private" })` API로 교체하여 해결.
- **사이트 전체 404 (`NOT_FOUND`, Runtime Logs에 요청 자체가 안 찍힘)**: 배포 실패가 반복되며 **Vercel 프로젝트 내부 라우팅 매니페스트가 손상**된 것으로 추정. **해결책은 같은 GitHub 저장소를 가리키는 새 Vercel 프로젝트를 만들어 import하는 것**.
- **재배포 누락으로 인한 ENOENT**: Blob 스토어 연결 직후 `BLOB_READ_WRITE_TOKEN`이 실행 중인 배포에 반영되지 않아 로컬 파일 쓰기를 시도하다 실패. Redeploy로 해결.

## 7. 알려진 제약사항 / 성능 관련 잠재 이슈 (v2.10 기준 — v2.11에서 상당 부분 해소 예정)

- **매 요청마다 전체 DB JSON을 읽고 쓴다.** → v2.11에서 테이블별 타겟팅된 쿼리로 대체 (§10.4).
- **모든 페이지가 `force-dynamic`이라 캐싱이 없다.** → v2.11 범위 밖, 추후 검토.
- **통계 계산이 매 요청마다 전체 게임을 순회**한다. → v2.11에서 화면별 필요한 데이터만 조회하도록 일부 개선하나, 집계 로직 자체(순수 함수)는 유지 (§10.4).
- **동시성 제어가 단일 프로세스 in-memory 큐에만 의존**한다. → v2.11에서 Postgres의 행 단위 원자성으로 대체, 대부분의 케이스에서 자연히 해소 (§10.4).
- **드래그 컴포넌트가 마운트 후에만 DndContext를 렌더링**한다 — 초기 로드 시 약간의 레이아웃 시프트. (저장소와 무관, 미해결)

## 8. v2.0 요구사항 (구현 완료)

관리자 모드(`ADMIN_PASSWORD` + 별도 쿠키), 과거 누적기록 입력, 게임 종목·자동 시각 기록·점수·N차전, 게임 소프트 삭제, "1등/꼴찌"→"Win/Lose" 용어 통일, 정산 카드 UI + 탕감→기부 확장, 게임 목록 기간 필터, 참가자별 상대 전적, 기부 랭킹, 관리자 데이터 롤백.

## 9. v2.10 요구사항 (구현 완료)

**버그 수정 4건**: ① 모바일 드래그 앤 드롭 미작동 — `touch-action` 설정, `DragOverlay`, 탭-투-탭 대체 입력 추가. ② 기부의 잔액 반영 방향이 반대였던 것 — `donation`(레거시 `waiver` 포함)을 `from −amount / to +amount`로 수정(§3.1 표 참고). ③ 관리자 전용 탭이 비관리자에게도 노출되던 것 — 관리자 모드일 때만 렌더링하도록 수정. ④ 정산이 한 번의 클릭으로 크게 실행될 수 있던 것 — 2단계 확인, 전액 정산 별도 조작화, 큰 금액 경고, 즉시 취소 동선 추가.

**기능 추가**: 게임 목록 구간 필터 내 인별 점수 합계, 대시보드 핫/콜드 플레이어·최근 폼·스트릭·오늘의 요약, 통계 화면 티어 뱃지·상대 전적 매트릭스·천적/밥·종목별 성적·기록실.

---

## 10. v2.11 요구사항 (저장소를 Supabase로 전환)

**진행 상태**: 애플리케이션 코드(§10.3, §10.4)와 스키마 파일·마이그레이션
스크립트(§10.2, §10.5)는 작성 완료(`npm run build`/`npm run lint`/
`scripts/verify-settle.ts` 통과). 다음 두 단계는 실제 Supabase 자격증명이
필요해 사용자 확인 하에 진행: (1) `supabase/schema.sql`을 Supabase SQL
Editor에서 실행하고 로컬에서 빈 테이블에 대고 CRUD 검증, (2) 검증 후
`scripts/migrate-to-supabase.ts`로 기존 프로덕션 데이터 마이그레이션.

### 10.1 배경 및 목적

현재 스토리지 계층(§5.2)은 매 요청마다 DB 전체 JSON을 Vercel Blob에서 읽고 쓰는 구조라, 기록이 늘어날수록 요청당 지연·비용이 선형 증가하고 여러 서버리스 인스턴스 간 동시성 문제도 이론상 존재한다(§7). 이를 해결하기 위해 저장소를 **Supabase(Postgres)**로 전환한다.

- 이미 생성된 Supabase 프로젝트: `BackRoom` (`https://idmnlbltfzegokencwgh.supabase.co`).
- **로컬 개발과 프로덕션 모두 동일한 방식으로 Supabase를 사용**한다 (로컬 전용 `data/db.json` 경로는 제거). 로컬에서 별도 프로젝트를 쓰고 싶다면 두 번째 Supabase 프로젝트를 만들어 `.env.local`에 다른 값을 넣으면 되지만, 필수는 아니다.
- **기존 Vercel Blob의 실사용 데이터(참가자·게임·정산·과거기록)를 그대로 Supabase로 마이그레이션한다.** 각 레코드의 `id`, `createdAt` 등은 보존되어야 한다 (관리자 롤백 등 시간 기반 로직이 `createdAt`에 의존하므로).

### 10.2 데이터 모델 (Postgres 스키마)

```sql
create extension if not exists "pgcrypto";

create table participants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create type game_type as enum ('hoola', 'citadels', '6nimmt');

create table games (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  time time,                        -- nullable: 레거시 레코드에는 없을 수 있음
  game_type game_type,              -- nullable: 레거시 레코드에는 없을 수 있음 → UI에서 "미상"
  points integer not null default 1,
  active boolean not null default true,
  attendee_ids uuid[] not null,     -- 배열 원소에 대한 FK 제약은 걸지 않음 (의도적 트레이드오프)
  winner_id uuid not null references participants(id),
  loser_id uuid not null references participants(id),
  note text,
  created_at timestamptz not null default now()
);
create index games_date_idx on games(date);
create index games_active_idx on games(active);
create index games_created_at_idx on games(created_at);

create type settlement_type as enum ('payment', 'donation');

create table settlements (
  id uuid primary key default gen_random_uuid(),
  type settlement_type not null default 'payment',
  from_id uuid not null references participants(id),
  to_id uuid not null references participants(id),
  amount integer not null check (amount > 0),
  date date not null,
  note text,
  created_at timestamptz not null default now()
);
create index settlements_created_at_idx on settlements(created_at);

create table adjustments (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references participants(id),
  to_id uuid not null references participants(id),
  amount integer not null check (amount > 0),
  note text,
  date date not null,
  created_at timestamptz not null default now()
);
create index adjustments_created_at_idx on adjustments(created_at);

alter table participants enable row level security;
alter table games enable row level security;
alter table settlements enable row level security;
alter table adjustments enable row level security;
-- 정책은 만들지 않는다(=사실상 전체 잠금). 앱은 서버에서만 서비스 롤 키로
-- 접근하며 이 키는 RLS를 우회한다 — §10.3 참고.
```

정규화 결정:
- 레거시 `waiver`는 마이그레이션 시점에 `donation`으로 정규화해서 저장한다 (DB 엔움에는 `payment`|`donation` 두 값만 존재. 애플리케이션 타입의 `SettlementType`에서 `"waiver"`는 계속 남겨두되, DB에서 나온 값은 항상 두 값 중 하나이므로 사실상 사용되지 않는다).
- 레거시 게임의 `points`(없으면 1), `active`(없으면 true)는 마이그레이션 시 채워 넣어 컬럼을 NOT NULL로 강제한다.
- `game_type`, `time`은 레거시 게임에 없을 수 있으므로 nullable로 유지한다.

### 10.3 접근 제어

모든 테이블은 RLS를 켜두되 정책은 만들지 않는다. 앱은 서버에서만 `SUPABASE_SERVICE_ROLE_KEY`로 접근하며, 이 키는 RLS를 완전히 우회한다 — 브라우저에는 절대 노출되지 않아야 한다(기존에도 클라이언트에서 직접 스토리지에 접근하는 코드는 없으므로 위험이 없다). 이 방식은 기존 설계(접근 제어는 앱 레이어의 `SITE_PASSWORD`/`ADMIN_PASSWORD`가 담당하고 DB 레이어에는 두지 않음)와 일관된다.

### 10.4 애플리케이션 계층 변경

- `src/lib/storage.ts`의 로컬 파일/Vercel Blob 분기 로직을 제거하고 `@supabase/supabase-js` 클라이언트로 교체한다.
- 기존 `mutateDB(fn)` 패턴(전체 읽기 → 메모리 수정 → 전체 쓰기, in-memory 뮤텍스로 직렬화)은 폐기한다. 대신 `src/lib/actions.ts`의 각 서버 액션을 해당 테이블에 대한 **타겟팅된 INSERT/UPDATE/DELETE**로 다시 작성한다 (예: `addParticipant` → participants 1행 INSERT, `deleteGame` → games 1행 UPDATE `active=false`).
- 대부분의 액션은 단일 테이블·단일 행 작업이라 Postgres의 행 단위 원자성만으로 충분하며, 기존 in-memory 뮤텍스 없이도 동시성 문제가 생기지 않는다.
- 예외: **관리자 롤백**은 games/settlements/adjustments 세 테이블에 걸쳐 여러 행을 지우는 작업이므로, 가능하면 Postgres 함수(RPC)로 묶어 원자적으로 실행한다. 여의치 않으면 순차 실행하되 실패 지점을 로그로 남긴다.
- 잔액 계산(`settle.ts`)과 통계(`stats.ts`)는 지금처럼 필요한 데이터를 가져와 기존 순수 함수로 계산하는 방식을 유지한다(이미 검증된 로직 재사용). 다만 "DB 전체"를 매번 가져오지 말고 화면별로 필요한 테이블/컬럼만 조회하도록 데이터 패칭을 정리한다.

### 10.5 마이그레이션

- 기존 프로덕션 데이터(Vercel Blob의 `db.json`)를 한 번만 읽어 위 4개 테이블에 그대로 넣는 1회성 스크립트(`scripts/migrate-to-supabase.ts`)를 작성한다. `BLOB_READ_WRITE_TOKEN`(기존 값)과 `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`(신규)를 모두 로컬 환경변수로 설정한 상태에서 한 번 실행한다.
- 스크립트는 삽입 전 대상 테이블이 비어 있는지 확인하고, 비어있지 않으면 중단한다 (실수로 중복 실행되는 것 방지).
- 마이그레이션 후 각 테이블의 행 수가 원본 컬렉션 길이와 일치하는지 콘솔에 출력해 검증한다.

### 10.6 환경변수 변경

| 변수 | 상태 |
| --- | --- |
| `SUPABASE_URL` | 신규 — `https://idmnlbltfzegokencwgh.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | 신규 — Supabase 대시보드 Settings → API에서 확인 (비밀값, 절대 커밋 금지) |
| `BLOB_READ_WRITE_TOKEN` | 마이그레이션 완료 확인 후 제거 가능 |
| `SITE_PASSWORD`, `ADMIN_PASSWORD` | 변경 없음 |

### 10.7 성공 기준

- 로컬 개발(`npm run dev`)과 Vercel 프로덕션 모두 Supabase를 통해 동작한다.
- 마이그레이션 후 기존 참가자/게임/정산/과거기록이 개수·내용 그대로 조회된다.
- 잔액 계산, 통계, 관리자 롤백 등 기존 기능이 마이그레이션 전과 동일하게 동작한다(회귀 없음).
- `npm run build`, `npm run lint` 통과.
- README에 로컬 개발 환경 설정 방법(Supabase 프로젝트 연결, 스키마 적용 방법)이 갱신된다.

## 11. 다음 단계

v2.11 구현은 이 문서를 기준으로 Claude Code 세션에서 진행한다. 구체적인 작업 지시는 `CLAUDE_CODE_PROMPT_V2_11_SUPABASE.md`에 정리되어 있다.
