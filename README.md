# 랜덤픽 — 점심 뭐먹을래?

기준점을 끌면 **지도가 물로 덮이고**, 놓으면 조약돌이 수면 위를 통통 튀며 날아갑니다.
바운스마다 물이 한 겹씩 빠지고, 마지막 바운스에서 수면이 걷히며 그 자리에서 가장 가까운
식당이 공개됩니다.

점심 메뉴를 "고르는" 게 아니라 "던져서 맞히는" 것으로 바꿔서 결과에 승복하게 만드는 것이 목표입니다.
방향과 힘은 내가 정하지만 정확히 조준할 수는 없습니다.

## 빠른 시작

```bash
npm install
npm run dev
```

**키가 없어도 바로 돌아갑니다.** 카카오 키가 없으면 좌표를 시드로 생성한 절차적 지도와
샘플 식당으로 폴백하고, 화면에 그 사실을 배너로 알립니다. 게임 흐름은 완전히 동일합니다.

## 실제 데이터 붙이기

### 1. 카카오 개발자 콘솔

[developers.kakao.com](https://developers.kakao.com)에서 앱을 만들고:

1. **앱 키** → `JavaScript 키`, `REST API 키` 복사
2. **플랫폼 > Web > 사이트 도메인** 등록 — **이걸 빼먹으면 지도가 안 뜹니다**
   - `http://localhost:3000`
   - `https://<your-project>.vercel.app`
   - 커스텀 도메인이 있다면 그것도

### 2. 환경 변수

`.env.example`을 `.env.local`로 복사해서 채웁니다.

| 이름 | 노출 | 없으면 |
| --- | --- | --- |
| `NEXT_PUBLIC_KAKAO_JS_KEY` | 클라이언트 | 절차적 캔버스 지도로 폴백 |
| `KAKAO_REST_KEY` | **서버 전용** | 샘플 식당 데이터로 폴백 |
| `UPSTASH_REDIS_REST_URL` | 서버 전용 | 캐시·rate limit이 인스턴스별로, 그룹 비활성 |
| `UPSTASH_REDIS_REST_TOKEN` | 서버 전용 | 위와 같음 |
| `KAKAO_DAILY_BUDGET` | 서버 전용 | 8000 (자체 호출 예산) |

> `KAKAO_REST_KEY`에 `NEXT_PUBLIC_` 접두사를 붙이지 마세요. REST 키는 도메인 제한이
> 없어서 유출되면 그대로 도용됩니다. JS 키는 브라우저에 노출되는 것이 정상이며
> 등록 도메인으로 보호됩니다.

키를 넣은 뒤 **실연동이 가정과 맞는지 먼저 확인하세요.** 연동 코드는 카카오 문서만 보고
작성한 것이라, 응답 형식이 다르면 이 스크립트가 잡아냅니다.

```bash
KAKAO_REST_KEY=xxx npm run verify:kakao
```

`category_name` 형식, 2번째 토큰이 매핑 테이블에 있는지, 45건 상한이 실제로 존재하는지,
`x`/`y`가 경도/위도 순서인지, 술집이 실제로 섞여 들어오는지를 확인합니다.

### 3. Vercel 배포 — GitHub Actions 경유

> **이 레포는 Vercel의 Git 자동 배포를 쓸 수 없습니다.**
> Hobby 플랜은 **private organization 레포**에서의 배포를 거부합니다
> (`Cannot deploy from a private GitHub organization repository on the Hobby plan`).
> Vercel 대시보드에는 "연결됨"으로 보이고 GitHub도 이벤트를 정상 전달하지만,
> 빌드가 이 메시지로 실패합니다.
>
> CLI 배포는 파일을 직접 업로드하므로 이 제약을 받지 않습니다. 그래서 배포를
> `.github/workflows/deploy.yml`로 옮겼습니다 — 레포는 org에 비공개로 두면서
> `main` 푸시마다 자동 배포됩니다.

**레포 Settings → Secrets and variables → Actions**에 세 개를 넣어야 합니다.

| Secret | 받는 곳 |
| --- | --- |
| `VERCEL_TOKEN` | [vercel.com/account/tokens](https://vercel.com/account/tokens) → Create Token |
| `VERCEL_ORG_ID` | 아래 `vercel link` 실행 후 `.vercel/project.json`의 `orgId` |
| `VERCEL_PROJECT_ID` | 같은 파일의 `projectId` |

```bash
npx vercel login
npx vercel link          # 프로젝트 선택
cat .vercel/project.json # orgId / projectId 확인 (.vercel은 gitignore됨)
```

넣고 나면 Actions 탭에서 `Run workflow`로 즉시 배포할 수 있습니다.
워크플로는 배포 전에 `typecheck` / `lint` / `test`를 통과해야 진행합니다.

> **Vercel 쪽 Git 연결은 끊어두세요** (`Settings → Git → Disconnect`).
> 남겨두면 푸시마다 위 오류로 실패한 Vercel 체크가 계속 붙어 커밋마다 빨간 ✗가 생깁니다.

수동으로 한 번 올리려면 로컬에서:

```bash
npx vercel --prod
```

**카카오 키보다 배포가 먼저입니다.** 카카오 콘솔에 등록할 도메인이 배포 후에 생깁니다.

```bash
npm run preflight   # 환경변수 조합이 어떤 동작을 만드는지 확인
```

키 없이 배포해도 샘플 모드로 정상 동작합니다.

### 배포가 안 될 때 확인 순서

이 프로젝트를 세우면서 실제로 겪은 것들입니다. 위에서부터 확인하면 대부분 걸립니다.

1. **GitHub 커밋에 붙은 Vercel 체크의 실패 사유를 먼저 읽으세요.** Vercel 대시보드보다
   빠릅니다. `gh api repos/<owner>/<repo>/commits/<sha>/status`의 `description`에 이유가
   그대로 들어 있습니다 — private org 레포 제약도 여기서 발견했습니다.
2. **빌드 시간이 1~2초면 빌드가 안 돌았다는 신호입니다.** 정상 빌드는 30초 이상 걸립니다.
   Deployments의 Duration 열을 먼저 보세요.
3. **Production Branch에 코드가 있는지 확인하세요.** 코드가 feature 브랜치에만 있는 상태로
   `main`을 Production Branch로 두면, `package.json`도 없는 커밋을 빌드해 산출물 없는
   배포가 만들어지고 모든 경로가 404가 됩니다.
4. **Redeploy는 최신 코드를 배포하지 않습니다** — 그 배포와 **같은 커밋**을 다시 배포합니다.
   머지한 뒤에는 Redeploy로 해결되지 않습니다.
5. **`NEXT_PUBLIC_*`는 빌드 시점에 번들로 구워집니다.** 환경변수만 추가하고 재배포하지
   않으면 기존 배포는 그 값을 영원히 모릅니다. 재배포 시 빌드 캐시도 끄세요.
6. **CDN 캐시에 속지 마세요.** 응답 헤더의 `age`가 계속 늘어나면 새 배포가 아예 생성되지
   않은 것입니다. 배포되면 `age`가 0으로 돌아갑니다.

배포되면 도메인이 세 종류 생깁니다.

| 종류 | 형태 | 안정성 |
| --- | --- | --- |
| 프로덕션 | `<project>.vercel.app` | 고정 |
| 브랜치 별칭 | `<project>-git-<branch>-<scope>.vercel.app` | 브랜치당 고정 |
| 배포별 URL | `<project>-<hash>-<scope>.vercel.app` | **커밋마다 바뀜** |

`<project>.vercel.app`은 **Vercel 전체에서 전역 고유**입니다. 이름이 이미 쓰이고 있으면
다른 도메인이 배정되므로, 추측하지 말고 프로젝트 Overview나 `npx vercel inspect <배포 URL>`로
실제 값을 확인하세요.

Deployment Protection(Vercel Authentication)이 켜져 있으면 **Vercel 로그인한 사람만** 접속할
수 있어 초대 링크 공유가 무의미해집니다. 공개할 앱이면 `Settings → Deployment Protection`에서
끄세요.

> **카카오 사이트 도메인은 와일드카드를 지원하지 않습니다.** `*.vercel.app`을 등록할 수
> 없으므로 **프로덕션 도메인과 브랜치 별칭을 각각 등록**하세요. 커밋별 preview URL에서는
> 지도가 뜨지 않는 것이 정상입니다. 자체 도메인을 붙이면 이 문제가 사라집니다.

리전은 `vercel.json`에서 `icn1`(서울)로 고정합니다. 기본값(`iad1`, 미국 동부)이면 서버가
`dapi.kakao.com`을 호출할 때마다 태평양을 왕복해서 리빌 판정이 눈에 띄게 느려집니다.

### 4. Upstash Redis 연결

```
Vercel → 프로젝트 → Storage 탭 → Create Database → Upstash for Redis
```

> **리전을 반드시 `ap-northeast-1`(도쿄)로 고르세요.** Vercel 함수가 서울(`icn1`)에서
> 돌기 때문에, us-east를 고르면 요청마다 Redis를 태평양 왕복하게 되어 모든 API 호출에
> 300ms 이상이 붙습니다. 서울 리전이 없으면 도쿄가 가장 가깝습니다.

연결하면 환경변수가 자동 주입됩니다. 통합 버전에 따라 이름이 두 가지로 갈립니다 —
`UPSTASH_REDIS_REST_URL` / `_TOKEN` 또는 예전 Vercel KV 이름인 `KV_REST_API_URL` / `_TOKEN`.
**코드가 양쪽 다 받으므로 이름은 신경 쓰지 않아도 됩니다.** (`REDIS_URL`은 `redis://`
프로토콜이라 REST 클라이언트로 쓸 수 없어 무시합니다)

주입 후 **재배포해야 런타임에 반영됩니다.** `npm run preflight`가 어느 이름으로 들어왔는지
찍어주니 확인에 쓰세요.

> **REST 키를 쓰면서 Upstash가 없으면 preflight가 실패합니다.** 캐시와 rate limit이
> 서버리스 인스턴스별로 흩어져서 카카오 쿼터를 예상보다 훨씬 빨리 태우고,
> 공개 프록시 보호도 무력해집니다.

## 구조

```
src/
├─ app/
│  ├─ page.tsx                  서버에서 env 유무만 불리언으로 전달
│  └─ api/
│     ├─ places/route.ts        카카오 로컬 프록시 + 캐시 + 폴백
│     └─ group/…                방 만들기 · 조건 조회 · 결과 피드
├─ lib/
│  ├─ geo.ts          거리·방위·투영
│  ├─ physics.ts      던지기 (순수함수, 테스트 대상)
│  ├─ prng.ts         시드 난수
│  ├─ categories.ts   카카오 category_name → 게임 대분류
│  ├─ mock-places.ts  좌표 시드 폴백 생성기
│  ├─ places-source.ts 카카오 조회 + 예산 · 서킷 브레이커
│  ├─ rate-limit.ts   IP별 고정창 상한
│  ├─ group.ts        그룹 스키마 · 검증
│  ├─ room-code.ts    초대 코드 생성 · 오타 보정
│  ├─ store.ts        Redis | 메모리 어댑터
│  └─ config.ts       밸런스 · 상한 상수 한곳에
├─ map/
│  ├─ kakao.ts        카카오맵 어댑터
│  └─ canvas-map.ts   절차적 폴백 지도
├─ hooks/
│  └─ useGroupFeed.ts 가시성 인지 폴링
└─ components/
   ├─ MapStage.tsx    지도 + 오버레이 캔버스 + 비행 애니메이션
   ├─ ControlSheet.tsx
   ├─ ResultCard.tsx
   ├─ GroupPanel.tsx
   └─ Game.tsx        상태 리듀서
```

`physics.ts`와 `geo.ts`는 DOM 의존이 없는 순수 함수입니다. 던지기 밸런스를 조정할 때
브라우저를 열지 않고 `npm test`로 검증할 수 있습니다.

## 설계 메모

**프리뷰와 정답 판정을 분리한 이유** — 카카오 로컬 API는 검색당 **최대 45건**(`size` 15 × `page` 3)만
페이징됩니다. 강남에서 반경 1km면 음식점이 수백 곳이라 전부 가져올 수 없습니다. 그래서
지도의 점은 "이 동네에 이런 게 있다"를 보여주는 **표본**이고, 실제 당첨은 **돌이 떨어진 자리를
중심으로 반경 300m를 다시 조회**해서 정합니다. 착지 반경은 좁아서 45건 상한에 걸리지 않고
`sort=distance`라 최근접 판정이 정확히 보장됩니다.

**술집 제외** — `FD6`에는 호프·요리주점이 섞여 들어옵니다. 점심에 호프집이 당첨되면 게임이
깨지므로 `categories.ts`에서 기본 제외합니다.

**지구 반지름 상수** — `distanceM`(하버사인)과 `destination`(평면 근사)이 **같은 반지름**을
써야 합니다. 흔히 쓰는 111320(적도 기준)을 섞어 쓰면 두 함수가 0.11% 어긋나서 던진 거리와
표시되는 거리가 미묘하게 안 맞습니다.

**좌표 시드 결정론** — 샘플 데이터는 `Math.random`이 아니라 좌표 격자를 시드로 쓴
`mulberry32`로 생성합니다. 그룹 플레이에서 조건이 같으면 모두가 같은 식당 세계를 봐야 합니다.

**좌표 변환** — 카카오 `Projection` API에 의존하지 않고 `getBounds()` + 컨테이너 크기에서
픽셀당 미터를 직접 계산합니다. 수 km 범위에서는 선형 근사로 충분하고 SDK 내부 변경에
영향받지 않으며, 폴백 지도와 같은 코드를 씁니다.

**메모리 스토어는 globalThis에 매답니다** — Next는 라우트마다 모듈을 따로 번들하므로,
모듈 스코프에 `Map`을 두면 `/api/group`이 쓴 값을 `/api/group/[code]`가 보지 못합니다.
같은 프로세스 안에서도 공유되지 않습니다.

## 쿼터 보호

`/api/places`는 **인증 없는 공개 프록시**입니다. 배포 URL을 아는 사람은 누구나 우리
카카오 쿼터를 쓸 수 있고, 리빌 판정은 착지점이 매번 달라 캐시가 거의 안 걸립니다
(**던지기 1회 = 카카오 호출 1~2회**). 그래서 네 겹으로 막습니다.

| 층 | 동작 |
| --- | --- |
| IP별 rate limit | `/api/places` 60회/분. 초과 시 `429` + `Retry-After` |
| 일일 호출 예산 | `KAKAO_DAILY_BUDGET` 초과 시 **실패시키지 않고** 샘플로 내려앉음 (KST 기준) |
| 서킷 브레이커 | `429` 수신 시 10분, 그 외 오류 시 1분간 카카오를 아예 건드리지 않음 |
| 클라이언트 쿨다운 | 던지기 연타 650ms 차단 |

예산은 **카카오 쿼터가 아니라 우리가 정한 상한**입니다. 실제 쿼터는 콘솔에서 확인한 뒤
보수적으로 잡으세요. 배너는 샘플로 내려앉은 이유를 구분해서 보여줍니다 —
키 없음 / 예산 소진 / 한도 쿨다운 / 조회 실패는 사용자가 할 수 있는 조치가 다릅니다.

## 그룹 플레이

방장이 조건을 저장하고 6자리 초대 코드를 받습니다. 참가자는 코드나 `?room=CODE` 링크로
들어와 **같은 기준점·반경·종류**로 던집니다.

- 코드는 Crockford Base32에서 혼동 문자(`I L O U`)를 뺀 32자. 입력 시 `I/L→1`, `O→0`, `U→V` 보정
- 7자 이상은 잘라서 통과시키지 않고 거부합니다 — 오타가 엉뚱한 방으로 들어가면 안 됩니다
- **"이걸로 결정"을 누를 때만** 전송합니다. 던질 때마다 자동 전송하지 않습니다
- 저장 항목은 닉네임·식당명·카테고리·거리·시각뿐. **사용자의 실제 좌표는 저장하지 않습니다**
- 방은 12시간 뒤 자동 소멸. 피드는 5초 폴링이되 **탭이 백그라운드면 요청을 보내지 않습니다**
- 닉네임만 브라우저 `localStorage`에 남깁니다 (편의)

로컬에서 Upstash 없이 검증하려면 `ALLOW_MEMORY_GROUP=1`을 켜세요. 서버리스에서는
인스턴스마다 메모리가 달라 동기화가 깨지므로 **프로덕션에서는 쓸 수 없습니다**
(`NODE_ENV=production`이면 코드가 무시합니다).

## 밸런스 조정

`src/lib/config.ts`의 `PHYSICS`에 모여 있습니다.

| 값 | 기본 | 의미 |
| --- | --- | --- |
| `PHYSICS.angleSigmaDeg` | 10° | 작으면 조준 게임, 크면 그냥 룰렛 |
| `PHYSICS.distanceSpan` | 0.85 | 최대 파워에서 반경의 1.2배 → 밖으로 나가 허탕 가능 |
| `PHYSICS.damping` | 0.6 | 홉이 짧아지는 비율 |
| `PHYSICS.blurStartPx` | 16 | 릴리즈 직후 블러 |
| `WATER.aimLevel` | 0.66 | 조준 중 수면 농도. 높이면 후보 점이 안 보임 |
| `WATER.easeRise` / `easeFall` | 0.19 / 0.07 | 물이 차는 속도 / 빠지는 속도 |

수면 연출은 `src/components/water.ts`에 모여 있습니다 — 상태 없는 그리기 함수들이라
게임 로직을 건드리지 않고 연출만 손볼 수 있습니다.

## 스크립트

```bash
npm run dev            # 개발 서버
npm run build          # 프로덕션 빌드
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm test               # 35개 단위 테스트 (물리·좌표·매핑·그룹)
npm run verify:kakao   # 카카오 실연동 검증 (KAKAO_REST_KEY 필요)
npm run preflight      # 배포 전 환경변수 점검
```

## 아직 안 된 것

- **카카오 실연동 미검증** — 연동 코드는 문서 기준으로 작성했고 실제 API로 호출해본 적이
  없습니다. 키를 받으면 `npm run verify:kakao`를 먼저 돌려주세요.
- **던지기 감각 미조정** — 노이즈·감쇠 값은 계산상 맞지만 실제로 던져보고 정해야 합니다.
- `npm audit`에 high 12건 — 전부 Next의 전이 의존성(`sharp`, `postcss`)이고 패치가
  Next 16부터입니다. `next/image`를 쓰지 않아 `sharp` 경로는 실행되지 않습니다.
- 사운드, OG 결과 이미지, 던진 기록
