# 게임 장부 (hoola_ledge) — PRD v2.13

- 최초 작성: 2026-08-13 / 최종 개정: 2026-08-13 (v2.13)
- 저장소: https://github.com/EDH1026/hoola_ledge
- 배포: Vercel 프로젝트 `hoola` (도메인: `hoola-three.vercel.app`), 팀 `HYSNESTR`
- 문서의 목적: 현재 구현된 기능/구조를 정리하고, 다음 릴리스들(v2.11 — Supabase 전환, v2.12 — 게임 기록 관리자 수정, v2.13 — 승무패/기록실/대리변제 등 마이너 업데이트 모음)의 범위를 확정하여 Claude Code 작업의 기준 문서로 사용

### 버전 이력

| 버전 | 내용 |
| --- | --- |
| v1.0 | 최초 구현 — 참가자 풀, 게임 기록(드래그 앤 드롭), 최소 거래 정산, 통계, 공유 비밀번호 인증, Vercel 배포 |
| v2.0 | 관리자 모드, 과거 누적기록, 게임 종목/시간 자동기록/점수/N차전, 게임 소프트 삭제, Win-Lose 용어 통일, 정산 카드 UI + 기부, 상대 전적, 기부 랭킹, 관리자 롤백 (구현 완료) |
| v2.10 | 버그 수정(모바일 드래그, 기부 방향, 관리자 탭 노출, 정산 안전장치) + 게임 구간별 인별 점수 합계 + 이스포츠 스타일 통계/대시보드 확장 (구현 완료) |
| v2.11 | 저장소를 Vercel Blob(JSON 파일)에서 Supabase(Postgres)로 전환 (구현 완료 — 스키마 적용·데이터 마이그레이션까지 완료 확인) |
| v2.12 | 게임 기록을 관리자 전용으로 수정(edit)할 수 있는 기능 추가 — §11 (구현 완료) |
| v2.13 | 승무패/승률A·B 표기, 기록실 top3·공동순위 개편, 통계 커스텀 기간, 게임 목록 기본 필터를 오늘로, 관리자 완전삭제, 대리 변제 — §13 (구현 완료 — 대리 변제는 Supabase 마이그레이션 적용 후 사용 가능, §13.7 참고) |

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
| `/games` | 로그인 | 게임 목록, 기간 필터, 기간 내 전체·인별 점수 합계, 소프트 삭제, **수정(관리자 전용, §11)** |
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
- **저장소: Supabase(Postgres)** — v2.11에서 Vercel Blob(JSON 파일)으로부터 전환 완료 (`@supabase/supabase-js`)

### 5.2 저장소 계층 (Supabase/Postgres) — v2.11에서 전환 완료

로컬 개발과 프로덕션 모두 동일한 Supabase 프로젝트(`BackRoom`, `https://idmnlbltfzegokencwgh.supabase.co`)를 사용한다. 로컬 전용 `data/db.json` 파일 경로는 제거되었다.

**테이블 구조** (`supabase/schema.sql`): `participants`, `games`, `settlements`, `adjustments` — §2의 애플리케이션 타입과 1:1로 대응한다(예: `GameResult.attendeeIds` → `games.attendee_ids`, camelCase↔snake_case). `games.game_type`/`games.time`은 레거시 레코드를 위해 nullable, `games.points`/`games.active`는 마이그레이션 시 기본값(1/`true`)을 채워 넣어 NOT NULL로 강제했다. `settlements.type`은 `payment`|`donation` 두 값만 갖는 Postgres enum이며, 레거시 `waiver`는 마이그레이션 시점에 `donation`으로 정규화되어 들어갔다.

**접근 제어**: 모든 테이블에 RLS를 켜두고 정책은 만들지 않는다(=사실상 전체 잠금). 앱은 서버 코드(`src/lib/supabase.ts`)에서만 `SUPABASE_SERVICE_ROLE_KEY`로 접근하며, 이 키는 RLS를 완전히 우회한다 — 브라우저에는 노출되지 않는다. 접근 제어는 여전히 앱 레이어의 `SITE_PASSWORD`/`ADMIN_PASSWORD`가 담당한다.

**데이터 접근 계층**: `src/lib/storage.ts`가 옛 로컬 파일/Vercel Blob 분기 로직(`mutateDB`, in-memory 뮤텍스)을 대체해, 테이블별 **타겟팅된 쿼리 함수**를 제공한다 (`listParticipants`/`insertParticipant`, `listGames`/`insertGame`/`softDeleteGame`, `listSettlements`/`insertSettlement`/`deleteSettlementRow`, `listAdjustments`/`insertAdjustment`/`updateAdjustmentRow`/`deleteAdjustmentRow`, 그리고 대시보드·정산처럼 여러 테이블이 한꺼번에 필요한 화면을 위한 `getFullDB()`). 각 함수는 Postgres 행(snake_case)을 애플리케이션 타입(camelCase)으로 매핑하며, `timestamptz`/`time` 값의 포맷 차이를 흡수해 항상 이 앱이 기대하는 형태(`toISOString()`, `"HH:mm"`)로 정규화한다.

대부분의 서버 액션(`src/lib/actions.ts`)은 단일 테이블·단일 행 INSERT/UPDATE/DELETE이므로 Postgres의 행 단위 원자성만으로 충분하고, 옛 in-memory 뮤텍스 없이도 동시성 문제가 생기지 않는다. 예외는 **관리자 롤백**으로, games/settlements/adjustments 세 테이블에 걸친 삭제를 `rollback_after(cutoff)`라는 Postgres 함수(RPC)로 묶어 하나의 트랜잭션으로 원자적으로 실행한다(`countRollbackTargets`로 실행 전 삭제 대상 개수를 미리 보여준 뒤 확정).

잔액 계산(`settle.ts`)과 통계(`stats.ts`)는 여전히 필요한 데이터를 가져와 기존 순수 함수로 계산하는 방식이다 — 로직 자체는 저장소 전환과 무관하게 그대로 재사용되었다.

### 5.3 페이지 렌더링

Cache Components가 아닌 기존 라우트-세그먼트 설정 모델을 사용하며, DB를 읽는 모든 `(app)/` 페이지에 `export const dynamic = "force-dynamic"`을 명시해 정적 프리렌더링을 막고 있다.

## 6. 배포 환경 및 트러블슈팅 기록

### 6.1 필수 환경변수 (v2.11 기준)

| 변수 | 설명 |
| --- | --- |
| `SITE_PASSWORD` | 앱 접속용 공유 비밀번호 |
| `ADMIN_PASSWORD` | 관리자 모드 비밀번호 |
| `SUPABASE_URL` | Supabase 프로젝트 URL (`https://idmnlbltfzegokencwgh.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 서비스 롤 키(비밀값). Supabase 대시보드 Settings → API에서 확인, 절대 커밋 금지 |

`BLOB_READ_WRITE_TOKEN`은 v2.11 마이그레이션 완료로 더 이상 앱 코드에서 쓰이지 않는다(`scripts/migrate-to-supabase.ts`를 다시 돌릴 일이 없다면 Vercel 환경변수에서 제거해도 된다).

환경변수를 추가/변경한 뒤에는 반드시 **Redeploy**해야 반영된다.

### 6.2 겪었던 문제와 해결

- **Private Blob 스토어 읽기 실패**: 초기 구현은 `access: "public"`으로 `put()`하고 raw `fetch()`로 읽었으나, Private 접근 모드 스토어에서 실패. `@vercel/blob`의 `get(pathname, { access: "private" })` API로 교체하여 해결.
- **사이트 전체 404 (`NOT_FOUND`, Runtime Logs에 요청 자체가 안 찍힘)**: 배포 실패가 반복되며 **Vercel 프로젝트 내부 라우팅 매니페스트가 손상**된 것으로 추정. **해결책은 같은 GitHub 저장소를 가리키는 새 Vercel 프로젝트를 만들어 import하는 것**.
- **재배포 누락으로 인한 ENOENT**: Blob 스토어 연결 직후 `BLOB_READ_WRITE_TOKEN`이 실행 중인 배포에 반영되지 않아 로컬 파일 쓰기를 시도하다 실패. Redeploy로 해결.

## 7. 알려진 제약사항 (v2.11 기준)

v2.11(Supabase 전환)로 해소된 이슈: 매 요청마다 DB 전체 JSON을 읽고 쓰던 문제(→ 테이블별 타겟팅된 쿼리), 동시성 제어가 단일 프로세스 in-memory 큐에만 의존하던 문제(→ Postgres 행 단위 원자성 + 롤백은 RPC 트랜잭션).

남아있는 이슈:

- **모든 페이지가 `force-dynamic`이라 캐싱이 없다.** 대시보드/통계처럼 자주 안 바뀌는 화면도 매번 새로 렌더링 + 쿼리한다. 저장소 전환과 무관한 별도 과제.
- **통계·정산·대시보드 화면은 여전히 필요한 테이블(예: games+settlements+adjustments) 전체를 가져와 애플리케이션 메모리에서 집계**한다(`getFullDB()`). 타겟팅된 쿼리로 바뀌긴 했지만, 데이터양이 커지면 이 방식도 언젠가 SQL 집계(뷰·RPC)로 옮길 필요가 있을 수 있다.
- **드래그 컴포넌트가 마운트 후에만 DndContext를 렌더링**한다(SSR 하이드레이션 불일치 회피) — 초기 로드 시 약간의 레이아웃 시프트. 저장소와 무관, 미해결.

## 8. v2.0 요구사항 (구현 완료)

관리자 모드(`ADMIN_PASSWORD` + 별도 쿠키), 과거 누적기록 입력, 게임 종목·자동 시각 기록·점수·N차전, 게임 소프트 삭제, "1등/꼴찌"→"Win/Lose" 용어 통일, 정산 카드 UI + 탕감→기부 확장, 게임 목록 기간 필터, 참가자별 상대 전적, 기부 랭킹, 관리자 데이터 롤백.

## 9. v2.10 요구사항 (구현 완료)

**버그 수정 4건**: ① 모바일 드래그 앤 드롭 미작동 — `touch-action` 설정, `DragOverlay`, 탭-투-탭 대체 입력 추가. ② 기부의 잔액 반영 방향이 반대였던 것 — `donation`(레거시 `waiver` 포함)을 `from −amount / to +amount`로 수정(§3.1 표 참고). ③ 관리자 전용 탭이 비관리자에게도 노출되던 것 — 관리자 모드일 때만 렌더링하도록 수정. ④ 정산이 한 번의 클릭으로 크게 실행될 수 있던 것 — 2단계 확인, 전액 정산 별도 조작화, 큰 금액 경고, 즉시 취소 동선 추가.

**기능 추가**: 게임 목록 구간 필터 내 인별 점수 합계, 대시보드 핫/콜드 플레이어·최근 폼·스트릭·오늘의 요약, 통계 화면 티어 뱃지·상대 전적 매트릭스·천적/밥·종목별 성적·기록실.

---

## 10. v2.11 요구사항 (구현 완료)

저장소를 Vercel Blob(JSON 파일)에서 **Supabase(Postgres)**로 전환했다. participants/games/settlements/adjustments 4개 테이블 스키마(`supabase/schema.sql`), RLS 켜두고 정책 없이 서비스 롤 키로만 접근하는 방식, `mutateDB` 폐기 후 테이블별 타겟팅된 쿼리로의 액션 재작성, 관리자 롤백을 위한 `rollback_after` RPC 트랜잭션, 기존 프로덕션 데이터 마이그레이션(`scripts/migrate-to-supabase.ts`, id·createdAt 보존, 레거시 `waiver`→`donation` 정규화)까지 모두 완료되었다. 현재 아키텍처 상세는 §5.2 참고. 환경변수는 §6.1, 이 전환으로 해소된 이슈는 §7 참고.

## 11. v2.12 요구사항 (게임 기록 관리자 수정, 구현 완료)

### 11.1 배경

현재 게임 기록은 소프트 삭제(§8.3)만 가능하고 수정 기능이 없다. 종목·참석자·Win/Lose·점수·메모를 잘못 입력했을 때 삭제 후 재입력해야 하는데, 재입력하면 기록 시각이 실제 게임 시각이 아니라 재입력 시점으로 다시 자동 저장되어(§1의 "날짜·시각 자동 기록" 규칙) 원래 기록 시각이 틀어지는 문제가 있다. 이를 해결하기 위해 **관리자에 한해** 기존 게임 기록을 직접 고칠 수 있는 기능을 추가한다.

### 11.2 요구사항

- 게임 목록(`/games`)에서 **관리자 모드일 때만** 각 게임 옆에 "수정" 버튼이 노출된다. 비관리자에게는 보이지 않는다 (§9에서 확립한 "관리자 전용 UI는 아예 숨긴다" 원칙을 그대로 따른다).
- 수정 가능한 항목: 게임 종목, 참석자, Win/Lose, 점수, 메모.
- **날짜·시각도 관리자에 한해 예외적으로 수정 가능**하게 한다. 일반 게임 등록 흐름(`/games/new`)에서는 여전히 자동 기록·수정 불가 상태를 유지한다 — 이 예외는 관리자가 오기록을 바로잡는 용도로만 존재한다. 날짜·시각을 바꾸면 "N차전" 순번과 기간 필터 결과가 달라질 수 있음을 화면에 안내한다.
- 검증 규칙은 신규 게임 등록(`createGame`)과 동일하게 적용한다: 참석자 2명 이상, Win/Lose 모두 참석자에 포함, Win과 Lose는 서로 달라야 함.
- **소프트 삭제된(비활성) 게임도 열람·수정할 수 있다.** 소프트 삭제는 장부 계산에서 제외한다는 의미일 뿐 기록을 잠그는 것이 아니므로, 실수로 지운 기록의 내용을 고치면서 다시 활성화하는 시나리오를 지원한다. 수정 화면에서 활성/비활성 상태도 함께 토글할 수 있게 한다.
- 새 서버 액션 `updateGame(id, input)`은 **액션 내부에서 관리자 세션을 직접 검증**한다 (페이지 라우팅 보호에만 의존하지 않는다 — 기존 과거기록/롤백 액션과 동일한 방어적 패턴을 따른다).
- 실수 방지를 위해 저장 버튼 한 번으로 바로 반영되지 않도록, §9.1.4에서 정산에 도입한 것과 같은 가벼운 확인 단계(변경 전/후 값을 요약해서 보여준 뒤 저장)를 둔다.
- 수정 후 잔액·통계·N차전 계산에 즉시 반영되어야 한다 (기존 `revalidatePath` 패턴 재사용).
- 수정 이력(누가 언제 무엇을 바꿨는지)은 이번 범위에서는 남기지 않는다 — 필요해지면 추후 별도로 다룬다.

### 11.3 성공 기준

- 관리자 모드에서만 게임 목록에 수정 버튼이 보인다.
- 잘못 기록된 게임의 종목/참석자/승패/점수/메모/날짜·시각을 고칠 수 있고, 저장 후 대시보드/정산/통계에 즉시 반영된다.
- 관리자 쿠키 없이 `updateGame` 서버 액션을 직접 호출해도 거부된다.
- `npm run build`, `npm run lint` 통과.

### 11.4 v2.11(Supabase 전환)과의 관계

v2.11이 이미 완료되어 저장소가 Supabase 기반이므로, `updateGame`은 처음부터 §5.2에서 설명한 데이터 접근 계층(`src/lib/storage.ts`) 위에 구현한다 — `games` 테이블에 대한 타겟팅된 1행 UPDATE(`updateGameRow` 같은 함수를 `insertGame`/`softDeleteGame` 옆에 추가) + `src/lib/actions.ts`의 `updateGame` 액션(다른 관리자 전용 액션들과 동일하게 내부에서 `requireAdmin()` 호출)이면 된다. 옛 `mutateDB` 패턴을 신경 쓸 필요는 없다.

### 11.5 구현 노트 (판단이 필요했던 부분)

- `src/lib/storage.ts`에 `updateGameRow(id, input)`을 `insertGame`/`softDeleteGame` 옆에 추가(1행 UPDATE → `.select().single()` → `mapGame()`). `src/lib/actions.ts`는 `createGame`의 검증 로직을 `validateGameInput()`으로 추출해 `updateGame`과 공유하고, `updateGame`은 `requireAdmin()`을 가장 먼저 호출한 뒤 날짜/시각 형식만 추가로 검증한다(`nowInSeoul()`은 쓰지 않고 관리자가 입력한 값을 그대로 저장 — §11.2 예외).
- **수정 폼은 인라인으로 펼치는 방식**을 선택했다(별도 화면 대신). 목록에서 바로 "수정"을 누르면 해당 게임 항목 아래에 폼이 확장되는 방식이 컨텍스트 전환 없이 다른 게임과 비교하며 고치기 편하고, `/games/new`와 톤을 맞추면서도 이동 없이 완결된다.
- **Win/Lose 선택 UI는 `NewGameForm`의 드래그/탭 방식 대신 일반 `<select>` 두 개**로 구현했다. 드래그는 빠른 신규 입력에 최적화된 제스처이고, 수정은 여러 필드를 한 번에 재확인하며 고치는 작업이라 드롭다운이 더 예측 가능하고 실수하기 어렵다고 판단했다. 참석자 체크박스를 해제해 Win/Lose로 지정된 사람이 목록에서 빠지면 해당 선택값을 자동으로 비운다.
- **확인 단계**는 §9.1.4와 동일하게, 저장 전에 변경 전/후 값을 항목별로 대조해서 보여주는 화면(종목/참석자/Win·Lose/점수/메모/날짜/시간/활성 상태)을 넣었다. 날짜·시각이 바뀐 경우에만 "N차전 번호와 날짜 필터 결과가 달라질 수 있다"는 경고 배너를 추가로 보여준다. 저장 버튼은 삭제(빨간 텍스트 링크)와 명확히 구분되도록 초록색(`emerald-600`) 버튼으로 스타일링했다.
- **비활성(소프트 삭제) 게임 표시**: 관리자 화면에서만 비활성 게임이 섞여 나오므로, "비활성" 뱃지(`src/components/badges.tsx`의 `InactiveBadge`)와 옅은 배경/글자 톤으로 구분했다. 이미 비활성인 게임은 "삭제" 버튼을 숨기고(더 지울 것이 없으므로) "수정"만 노출해, 수정 화면의 활성 상태 체크박스로 재활성화하도록 안내한다.
- **잔액/통계 집계는 관리자 화면에서도 항상 활성 게임만 사용**하도록 `GamesListClient`에서 `filtered.filter(isActiveGame)`을 별도로 구해 점수 합계·인별 점수 표에 사용했다(목록 자체는 관리자에게 비활성 게임도 보여주되, 집계에는 포함하지 않음 — `activeGames()`의 기존 계약을 그대로 유지).
- `games/page.tsx`는 관리자에게는 `listGames()`(전체), 비관리자에게는 `activeGames(allGames)`만 클라이언트에 전달한다. 헤더의 "총 N회" 카운트는 관리자 여부와 무관하게 항상 활성 게임 수만 표시해 일관성을 유지한다.
- 브라우저로 실제 검증: 관리자 상태에서 종목/참석자/Win-Lose/점수/날짜·시각/활성 상태를 각각 수정 → 확인 단계 diff 및 대시보드 반영 확인, 소프트 삭제 → 관리자 화면에서 비활성 뱃지로 열람 → 수정 화면에서 재활성화까지 확인, 비관리자 세션에서는 수정 버튼 자체가 렌더링되지 않고 비활성 게임도 전혀 보이지 않음을 확인. `requireAdmin()` 방어도, 관리자 UI가 열린 상태에서 별도 탭으로 관리자 세션을 로그아웃시킨 뒤(쿠키는 브라우저 전체에서 공유되므로 즉시 반영) 저장을 시도해 "관리자 인증이 필요합니다." 서버측 거부를 직접 재현해 확인했다.

## 13. v2.13 요구사항 (마이너 업데이트 모음, 구현 완료)

한 번에 요청된 여러 개의 작은 개선사항 묶음이다. 스키마 변경이 필요 없는 항목(13.1~13.6)과 필요한 항목(13.7, 대리 변제)으로 나눠 별도 커밋으로 작업했다 — 전자는 즉시 배포 가능하지만 후자는 Supabase에 enum 값을 추가하는 마이그레이션을 먼저 적용해야 한다.

### 13.1 승/무/패 표기

기존에는 참가자 성적을 "승/패"로만 보여줬는데, 3명 이상이 참여하는 게임에서는 Win도 Lose도 아닌 참석("무")이 존재한다. 무는 저장하지 않고 `참여 − 승 − 패`로 계산한다 (기존 `ParticipantStat.appearances`를 그대로 활용). 대시보드 순위와 통계 순위표에 반영했다.

### 13.2 승률A / 승률B

승률A = 승/(승+패) (기존 `winRate`), 승률B = 승/참여 (신규 `winRateB`, `src/lib/stats.ts`의 `computeParticipantStats`/`computeGameTypeStats`에 추가). 통계 순위표와 종목별 성적 표 모두에 두 값을 나란히 표기한다.

### 13.3 종목별 성적: 정렬 변경, "최강" 표기 제거

기존에는 순점수 기준 정렬 + 1위에게 "최강" 태그를 붙였는데, 정렬을 승률A(1순위)·승률B(2순위) 기준으로 바꾸고 "최강" 태그는 제거했다.

### 13.4 기록실 개편

- **단일 게임 최고 점수 삭제** — 더 이상 의미 있는 기록으로 취급하지 않는다.
- **최장 연승/연패에 기간(시작일~종료일) 표기 추가**. 스트릭이 진행된 기간의 날짜 범위를 함께 보여준다.
- **top 3, 공동 순위 지원**: 기존에는 카테고리당 1명만 보여줬는데, distinct value 기준 상위 3개 구간(dense ranking — 1위, 2위, 3위이고 동점자는 모두 같은 구간에 "공동 N위"로 표시, skip 없음)까지 표시하도록 `computeRecords`를 재작성했다(`RecordTier`/`RecordTierEntry`, `topTiers()` 헬퍼).

### 13.5 통계 조회 기간 직접 입력

기존 프리셋(최근 7/30/90일, 올해, 전체) 외에 "직접 입력"을 추가해 시작일·종료일을 날짜로 지정할 수 있다. `RangePreset`에 `"custom"`을 추가하고 `filterByDatePreset`이 `custom: { start?, end? }`을 받아 `yyyy-MM-dd` 문자열을 직접 비교한다(모든 `.date` 필드가 이미 Asia/Seoul 벽시계 문자열이므로 `new Date()` 파싱을 거치면 UTC 자정으로 해석되어 하루가 밀릴 수 있어, 문자열 비교로 그 문제를 원천적으로 피했다).

### 13.6 게임 목록 기본 필터 = 오늘, 관리자 완전삭제

- `/games`의 연도/월/일 필터 기본값을 "전체"에서 오늘(Asia/Seoul, `todayInSeoul()`)로 바꿨다. 필터 비교 로직이 패딩 없는 문자열(`String(Number(...))`)을 쓰므로 기본값도 동일한 포맷으로 맞췄고, 올해 옵션이 항상 선택 가능하도록 연도 목록에 강제로 포함시켰다.
- 관리자는 기존 소프트 삭제("삭제") 외에 **완전삭제**(하드 삭제, `deleteGameRow`/`hardDeleteGame`)를 쓸 수 있다. `requireAdmin()`으로 보호되며, 되돌릴 수 없는 작업이라 인라인 2단계 확인(예/아니오)을 거친다. 롤백 화면에서도 복구할 수 없다는 점에 유의.

### 13.7 대리 변제 (⚠ Supabase 마이그레이션 필요)

누군가(대리인)가 다른 사람(원 채무자)의 빚을 대신 갚아줄 때 쓰는 새 정산 유형이다. 기부와 마찬가지로 정산 화면에서 자유롭게 기록할 수 있다(관리자 전용 아님).

**잔액 모델**: 대리인(payer)을 `fromId`, 받는 사람(creditor)을 `toId`로 하여 기존 "실제 정산"과 완전히 동일한 부호 규칙(`fromId += amount`, `toId -= amount`, §3.1)을 그대로 쓴다 — `src/lib/settle.ts`는 변경하지 않았다. 원 채무자(debtor)는 잔액 계산에 전혀 관여하지 않는다: 원 채무자가 갚아야 할 총액 자체는 그대로이고, 다만 갚을 대상이 원래 채권자에서 대리인으로 바뀔 뿐이다(예: A가 B를 대신해 C에게 10점을 갚으면 → C −10, A +10, B는 그대로 −10이지만 다음 정산 제안 시 A에게 갚는 쪽으로 자연히 계산된다). 원 채무자 정보는 잔액에 영향을 주지 않으므로 스키마를 건드리지 않고 `note` 필드에 "OOO 대신 지급"으로 자동 기록했다.

**스키마 변경**: `settlements.type`은 Postgres enum(`payment`, `donation`)이라 `proxy_payment` 값을 추가하려면 `ALTER TYPE settlement_type ADD VALUE`가 필요하다. `supabase/migrations/002_proxy_payment.sql`에 단일 문장으로 준비해뒀다(ADD VALUE는 트랜잭션 블록 밖에서 실행해야 해서 BEGIN/COMMIT 없이 단독 실행). **이 마이그레이션을 Supabase에서 실행하기 전까지는 대리 변제 저장 시 Postgres 에러가 난다** — 다른 기능에는 영향 없음(격리된 추가 값이라 blast radius가 작음). 코드는 커밋해두되, 사용자가 마이그레이션 적용을 확인하기 전까지 푸시를 보류했다(과거 v2.11 백엔드 전환 때와 같은 이유).

`SettlementType`/`WritableSettlementType`에 `"proxy_payment"` 추가, `normalizeSettlementType()`이 이를 그대로 통과시키도록 수정(기존에는 payment/donation 두 값으로만 정규화했음 — 그대로 뒀으면 대리 변제가 화면에서 "실제 정산"으로 잘못 표시되고 필터에도 안 걸렸을 것), `SettlementTypeBadge`에 라벨/색상(하늘색) 추가, 정산 이력 필터에 "대리 변제" 옵션 추가. 기부 랭킹 집계는 `normalizeSettlementType(...) === "donation"`만 걸러내므로 대리 변제는 자동으로 제외된다.

## 14. 다음 단계

v2.13까지의 구현은 이 문서를 기준으로 Claude Code 세션에서 진행했다. §13.7의 Supabase 마이그레이션 적용 여부를 확인한 뒤 해당 커밋을 푸시하는 것이 다음 단계다.
