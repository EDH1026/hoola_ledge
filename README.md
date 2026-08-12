# 게임 장부 (game-ledger)

매번 참가자가 바뀌는 게임에서 "꼴찌가 1등에게 1점을 지급"하는 규칙을 기록하고,
쌓인 채권-채무 관계를 최소 거래 수로 자동 정리해주는 앱입니다.

## 주요 기능

- 참가자 풀 관리 (전체 인원은 고정, 게임마다 참석자만 다르게 선택)
- 새 게임 등록 시 참가자 기본값 = 직전 게임 참가자와 동일
- 꼴찌 카드를 1등 카드 위로 드래그하면 결과가 자동 기록
- 채권-채무 관계를 최소 거래 수로 간소화 (예: A→B 2, B→C 1 이면 A→B 1, A→C 1로 정리)
- 정산(상품 교환) 완료 여부 추적
- 기간별(일/주/월/년) 승/패 통계 및 차트
- 공유 비밀번호 기반 접근 제한

## 로컬에서 실행하기

```bash
npm install
cp .env.local.example .env.local   # SITE_PASSWORD 값을 원하는 비밀번호로 수정
npm run dev
```

`http://localhost:3000` 접속 후 `.env.local`에 설정한 비밀번호로 로그인합니다.

로컬 개발 환경에서는 데이터가 `data/db.json` 파일에 저장됩니다 (git에는 포함되지 않음).

## Vercel에 배포하기

### 1. 코드를 GitHub 저장소로 올리기

```bash
git init   # 이미 되어있다면 생략
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

### 2. Vercel 프로젝트 생성

1. [vercel.com](https://vercel.com)에 로그인 후 "Add New… → Project"
2. 방금 만든 GitHub 저장소를 Import
3. Framework Preset은 Next.js가 자동으로 감지됩니다. 그대로 Deploy

### 3. 환경 변수 설정 (필수)

Vercel 프로젝트의 Settings → Environment Variables에서 아래 값을 추가하세요.

| 변수 | 설명 |
| --- | --- |
| `SITE_PASSWORD` | 앱 접속용 공유 비밀번호 |
| `BLOB_READ_WRITE_TOKEN` | 데이터 저장용 (아래 4번 참고) |

### 4. 데이터 저장소 연결 (필수 — 이 단계를 건너뛰면 데이터가 사라집니다)

Vercel의 서버는 배포마다 파일 시스템이 초기화되는 서버리스 환경이라, 로컬처럼
`data/db.json` 파일에 그냥 저장하면 데이터가 영구적으로 유지되지 않습니다. 이
프로젝트는 **Vercel Blob** 스토리지를 자동으로 사용하도록 되어 있으니, 배포 전에
반드시 연결해주세요.

1. Vercel 프로젝트 대시보드 → Storage 탭 → "Create Database" → **Blob** 선택
2. 생성 후 프로젝트에 연결하면 `BLOB_READ_WRITE_TOKEN` 환경 변수가 자동으로 추가됩니다
3. 환경 변수가 추가된 뒤에는 프로젝트를 한 번 재배포(Redeploy)해주세요

`BLOB_READ_WRITE_TOKEN`이 설정되어 있지 않으면 앱은 로컬 파일(`data/db.json`)에
쓰려고 시도하는데, Vercel 서버리스 환경에서는 이 파일이 요청마다 초기화될 수 있어
게임 기록이 사라질 수 있습니다.

### 5. 재배포

환경 변수를 모두 설정한 뒤 Vercel 대시보드에서 "Redeploy"를 눌러 반영하세요.

## 참고 사항

- 채권-채무 간소화 알고리즘은 `src/lib/settle.ts`에 있으며, `npx tsx
  scripts/verify-settle.ts`로 핵심 로직을 검증할 수 있습니다.
- 데이터는 참가자(participants) / 게임 기록(games) / 정산 이력(settlements) 세
  가지로 구성된 단순한 JSON 구조입니다 (`src/lib/types.ts`).
- 비밀번호를 바꾸고 싶다면 Vercel 환경 변수의 `SITE_PASSWORD` 값을 수정하고
  재배포하면 됩니다.
