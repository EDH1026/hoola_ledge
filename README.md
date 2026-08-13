# 게임 장부 (game-ledger)

매번 참가자가 바뀌는 게임에서 "Lose가 Win에게 1점을 지급"하는 규칙을 기록하고,
쌓인 채권-채무 관계를 최소 거래 수로 자동 정리해주는 앱입니다.

## 주요 기능

- 참가자 풀 관리 (전체 인원은 고정, 게임마다 참석자만 다르게 선택) — **관리자 전용**
- 게임 종목(훌라/시타델/젝스님트)과 점수(기본 1점, 조정 가능)를 기록. 날짜·시간은
  사용자가 입력하지 않고 기록 시점의 서버 시각(Asia/Seoul 기준)이 그대로 저장됨
- 같은 날 몇 번째 게임인지("N차전")를 조회 시점에 계산해서 보여줌
- 새 게임 등록 시 참가자 기본값 = 직전 게임 참가자와 동일
- Lose 카드를 Win 카드 위로 드래그하면 결과가 자동 기록
- 게임 삭제는 소프트 삭제(비활성화) — 잔액·통계·목록에서는 빠지지만 기록 자체는
  남아 있고, 완전 삭제는 관리자 롤백을 통해서만 가능
- 게임 목록에서 연/월/일 단위 필터와 필터링된 기간의 점수 합계를 확인 가능
- 참가자별 상대 전적(head-to-head) 조회 — 통계 화면의 순위표나 대시보드
  리더보드에서 이름을 클릭하면 상대별로 딴 점수/잃은 점수를 볼 수 있음
- 채권-채무 관계를 최소 거래 수로 간소화 (예: A→B 2, B→C 1 이면 A→B 1, A→C 1로 정리),
  이름+화살표+금액의 카드형 UI로 표시
- 정산은 "실제 정산"(계산된 채무를 갚음) 또는 "기부"(임의의 두 참가자 사이에서
  자유로운 금액을 자유롭게 줄 수 있음, 원래 갚아야 할 금액보다 많이 줘도 가능)
  중 선택해 기록, 이력에서 종류별 필터링, 기부 랭킹(가장 많이 준/받은 사람) 제공
- 앱 도입 이전의 채권-채무 관계를 게임 기록 없이 입력하는 **과거 누적기록** 기능 — **관리자 전용**
  (승패 통계에는 영향 없음, 정산 잔액에는 반영됨)
- 관리자가 특정 시각을 지정해 그 이후 생성된 게임/정산/과거 누적기록을 완전히
  삭제하는 **데이터 롤백** 기능 — **관리자 전용**, 미리보기와 확인 문구 입력 후에만 실행됨
- 기간(일/주/월/년)·게임 종목별 승/패 통계 및 차트
- 대시보드: 오늘의 요약, 핫/콜드 플레이어, 최근 폼(W/L), 현재 연승/연패 스트릭
- 통계: 티어 뱃지, 상대 전적 매트릭스(히트맵), 천적/밥, 종목별 성적, 기록실
- 공유 비밀번호 기반 접근 제한 + 관리자 비밀번호 기반 2단계 접근 제한

## 관리자 모드

`SITE_PASSWORD`로 로그인한 뒤, 상단 네비게이션의 "관리자 모드"를 눌러 별도의
`ADMIN_PASSWORD`를 입력하면 참가자 풀 관리(`/participants`), 과거 누적기록
입력(`/adjustments`), 데이터 롤백(`/rollback`) 화면에 접근할 수 있습니다.
관리자가 아닌 상태로 이 화면들에 접근하면 관리자 비밀번호 입력 화면으로
안내됩니다.

## 저장소: Supabase (Postgres)

v2.11부터 데이터는 **Supabase**(Postgres)에 저장됩니다. 로컬 개발과 프로덕션
배포 모두 같은 방식으로 Supabase에 접속합니다 — 로컬 전용 파일 저장소는 없습니다.

### 1. Supabase 프로젝트 준비

1. [supabase.com](https://supabase.com) 대시보드에서 프로젝트를 엽니다(이미
   만들어져 있다면 그 프로젝트를 그대로 씁니다).
2. **SQL Editor** → New query에 `supabase/schema.sql` 내용을 그대로 붙여넣고
   실행합니다. 이 스크립트는 4개 테이블(participants/games/settlements/
   adjustments)과 RLS(정책 없이 활성화만 — 서버의 서비스 롤 키만 접근 가능),
   관리자 롤백용 `rollback_after()` 함수를 만듭니다. **한 번만 실행하는
   스크립트**이며 재실행하면 실패합니다(이미 존재하는 테이블/타입을 다시
   만들려고 하기 때문) — 스키마를 나중에 바꾸려면 별도의 ALTER 스크립트를
   새로 작성하세요.
3. **Settings → API**에서 아래 두 값을 확인합니다.
   - **Project URL** → `SUPABASE_URL`
   - **service_role** 비밀 키(anon key 아님!) → `SUPABASE_SERVICE_ROLE_KEY`

`service_role` 키는 RLS를 완전히 우회하는 민감한 값입니다. 이 앱에서는
`src/lib/supabase.ts`(서버 전용, `import "server-only"`)에서만 사용하며,
브라우저로 전달되는 코드에는 절대 포함되지 않습니다.

### 2. 로컬에서 실행하기

```bash
npm install
cp .env.local.example .env.local   # SITE_PASSWORD, ADMIN_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 값을 채워 넣기
npm run dev
```

`http://localhost:3000` 접속 후 `.env.local`에 설정한 비밀번호로 로그인합니다.
로컬에서도 (별도의 파일 저장소 없이) 바로 위에서 설정한 Supabase 프로젝트에
직접 접속합니다.

### 3. Vercel에 배포하기

1. 코드를 GitHub 저장소로 올립니다.
   ```bash
   git init   # 이미 되어있다면 생략
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin <your-github-repo-url>
   git push -u origin main
   ```
2. [vercel.com](https://vercel.com)에서 "Add New… → Project"로 이 저장소를
   Import합니다. Framework Preset은 Next.js가 자동 감지됩니다.
3. Vercel 프로젝트의 Settings → Environment Variables에서 아래 값을 추가합니다.

   | 변수 | 설명 |
   | --- | --- |
   | `SITE_PASSWORD` | 앱 접속용 공유 비밀번호 |
   | `ADMIN_PASSWORD` | 관리자 모드(참가자 풀 관리, 과거 누적기록, 롤백) 접속용 비밀번호. `SITE_PASSWORD`와 다른 값을 권장 |
   | `SUPABASE_URL` | 위 1단계에서 확인한 Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | 위 1단계에서 확인한 service_role 키 |

4. 환경 변수를 추가/변경한 뒤에는 반드시 **Redeploy**해야 반영됩니다.

로컬 개발과 프로덕션이 같은 Supabase 프로젝트를 가리키게 되므로, 로컬에서
테스트하다가 실수로 실제 데이터를 건드리지 않으려면 별도의(두 번째) Supabase
프로젝트를 만들어 로컬 `.env.local`에는 그 프로젝트의 값을 넣는 것도 방법입니다
(필수는 아님).

### 4. 기존 데이터 마이그레이션 (Vercel Blob → Supabase, 최초 1회)

이미 Vercel Blob에 실사용 데이터가 쌓여 있는 상태에서 v2.11로 넘어오는
경우에만 필요합니다. 순서:

1. 위 1~2단계(스키마 적용, Supabase 값을 `.env.local`에 채우기)를 먼저
   끝내고, `npm run dev`로 참가자 추가 → 게임 기록 → 정산까지 한 번씩
   직접 실행해 Supabase 연결이 정상 동작하는지 먼저 확인하세요. (이 단계를
   건너뛰고 바로 마이그레이션하지 마세요 — 연결 설정이 잘못된 상태에서
   마이그레이션 스크립트를 돌리면 원인 파악이 더 어렵습니다.)
2. `.env.local`에 기존 Blob 스토어의 `BLOB_READ_WRITE_TOKEN`도 추가합니다
   (Vercel 프로젝트의 기존 환경 변수 값을 그대로 복사).
3. 다음 명령을 **한 번만** 실행합니다.
   ```bash
   npx tsx scripts/migrate-to-supabase.ts
   ```
   실사용 데이터에 손대는 작업이니 되도록 모임이 없는 조용한 시간에
   실행하세요. 스크립트는 실행 전 4개 테이블이 모두 비어있는지 확인하고,
   하나라도 비어있지 않으면 아무것도 하지 않고 즉시 중단합니다(중복 삽입
   방지). 완료되면 각 테이블의 삽입된 행 수를 원본과 비교해 콘솔에
   출력합니다.
4. 마이그레이션 후 실제 배포된 사이트에서 참가자/게임/정산/과거기록이 그대로
   보이는지 한 번 확인하세요.
5. 확인이 끝났다면 `BLOB_READ_WRITE_TOKEN`은 Vercel 프로젝트 환경 변수와
   `.env.local`에서 제거해도 됩니다(앱 코드는 더 이상 이 값을 참조하지
   않습니다 — 마이그레이션 스크립트 실행 시에만 필요했습니다).

## 참고 사항

- 채권-채무 간소화 알고리즘은 `src/lib/settle.ts`에 있으며, `npx tsx
  scripts/verify-settle.ts`로 핵심 로직(정산, 기부, 점수 가중치, 소프트 삭제,
  과거 누적기록, N차전 계산, 상대 전적)을 검증할 수 있습니다.
- 데이터는 Postgres(Supabase)의 4개 테이블(participants/games/settlements/
  adjustments, `supabase/schema.sql`)에 저장되지만, 애플리케이션 코드가
  다루는 모양은 여전히 `src/lib/types.ts`의 `Participant`/`GameResult`/
  `Settlement`/`LedgerAdjustment` 인터페이스입니다. `src/lib/storage.ts`가
  이 둘 사이를 매핑(snake_case ↔ camelCase, `timestamptz` 문자열 정규화,
  Postgres `time` 컬럼의 "HH:mm:ss" → 앱이 쓰는 "HH:mm" 등)하는 계층입니다.
  `game_type`/`time`처럼 레거시 레코드에 없을 수 있는 컬럼은 DB에서
  nullable로 두고, 읽을 때 앱 레벨의 안전한 기본값으로 처리합니다: `points`
  없으면 1점, `active` 없으면 활성 게임, 정산 `type`이 없거나 예전 값인
  `"waiver"`면 `"payment"`/`"donation"` 중 하나로 정규화됩니다
  (`normalizeSettlementType`, `src/lib/types.ts`).
- 데이터 접근은 화면마다 필요한 테이블만 조회합니다 — 참가자 목록/새 게임
  입력 화면은 `participants`(+게임 목록은 `games`)만, 잔액·정산 계산이
  필요한 대시보드·정산 화면은 4개 테이블 전부(`getFullDB()`)를 조회합니다.
  `mutateDB` 같은 전체 읽기-수정-쓰기 패턴은 더 이상 없으며, 대부분의
  서버 액션은 단일 테이블·단일 행에 대한 INSERT/UPDATE/DELETE 하나입니다
  (Postgres의 행 단위 원자성으로 충분). 예외는 관리자 롤백뿐인데, games/
  settlements/adjustments 세 테이블을 한 번에 지워야 해서
  `rollback_after()` Postgres 함수(`supabase/schema.sql`)로 묶어 하나의
  트랜잭션으로 실행합니다.
- 게임의 날짜·시간은 사용자가 입력할 수 없고, `createGame` 서버 액션이 호출되는
  시점의 실제 시각을 Asia/Seoul 기준으로 그대로 저장합니다 (`src/lib/time.ts`).
  Vercel 서버리스 함수는 기본적으로 UTC로 동작하므로, 서버가 어느 시간대에서
  돌든 항상 한국 시각으로 저장되도록 고정 +9시간 오프셋을 직접 계산합니다
  (한국은 서머타임이 없어 이 방식이 정확합니다).
- "N차전"(같은 날짜 몇 번째 게임인지)은 저장되지 않고, 조회 시점에 그 날짜의
  **활성** 게임을 종목 구분 없이 시간순으로 정렬해서 계산합니다
  (`src/lib/games.ts`). 한 모임에서 여러 종목을 섞어 하는 경우가 많아, "3차전"이
  그날 세 번째로 한 게임을 뜻하도록 한 것입니다.
- 게임 삭제는 소프트 삭제(`active: false`)이며, 잔액 계산(`computeNetBalances`)과
  통계 집계(`computeParticipantStats`, `groupGamesByPeriod`,
  `computeDailySequenceNumbers`) 안에서 직접 필터링하므로 호출하는 쪽에서
  깜빡하고 필터링을 빼먹어도 안전합니다. 단, 관리자 롤백(`previewRollback`/
  `executeRollback`)만은 예외로, 소프트 삭제 여부와 무관하게 `createdAt` 기준
  원본 데이터를 그대로 대상으로 삼습니다.
- "기부"는 예전의 "탕감"을 일반화한 개념입니다. 잔액 반영 공식은 정산과
  **반대 방향**입니다 — 주는 사람(`fromId`) 잔액 `-= amount`, 받는 사람
  (`toId`) 잔액 `+= amount` (게임에서 Lose→Win으로 점수가 이동하는 것과
  같은 방향). "실제 정산"(`payment`)은 반대로 빚을 갚는 공식(`from += / to -=`)을
  그대로 씁니다. 계산된 특정 채무-채권 거래에 묶이지 않고 임의의 두 참가자
  사이에서 자유로운 금액으로 기록할 수 있습니다(원래 갚아야 할 금액보다
  많이 줘도 됨). `/settlements`에서는 실수로 큰 금액이 바로 기록되지 않도록
  금액 입력 → 확인(전액/큰 금액 경고 포함) → 기록의 2단계를 거치며, 기록
  직후 "방금 기록됨 · 취소" 동선을 제공합니다.
- 게임 결과 입력(`/games/new`)은 드래그 앤 드롭 외에 Lose 카드 탭 → Win 카드
  탭 순서의 2탭 방식도 지원합니다(모바일에서 드래그가 여의치 않을 때의
  대체 수단). 드래그는 `@dnd-kit`의 `PointerSensor` 하나만 사용하고(터치
  입력까지 함께 처리하므로 `TouchSensor`와 병행하지 않음), 드래그 대상에
  `touch-action: none`을 지정해 모바일 브라우저의 기본 스크롤 제스처가
  드래그를 가로채지 않도록 합니다.
- 대시보드/통계 화면에는 이스포츠 스타일 지표가 추가되어 있습니다: 핫/콜드
  플레이어(최근 14일 승률과 통산 승률 비교, 최근 14일 3경기 미만이면 비교
  대상에서 제외), 최근 폼(W/L 뱃지), 현재 연승/연패 스트릭, 오늘의 요약,
  티어 뱃지(승률 기준 브론즈~챌린저), 상대 전적 매트릭스(히트맵), 천적/밥,
  종목별 성적, 기록실(최장 연승/연패, 단일 게임 최고 점수, 하루 최다 승리,
  최다 참석). 관련 순수 함수는 모두 `src/lib/stats.ts`에 있습니다.
- 비밀번호를 바꾸고 싶다면 Vercel 환경 변수의 `SITE_PASSWORD`/`ADMIN_PASSWORD`
  값을 수정하고 재배포하면 됩니다.
