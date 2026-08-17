# 08. 구매요청 시드 제거 및 등록 진입/폼 흐름 설계

> 범위: `frontend/src/features/requests/data/mock-requests.ts`의 시드 샘플 데이터를 제거하고, 실제 백엔드에 저장되는 구매요청 등록 진입점·폼·API를 추가한다. 판매자 지원("이 요청에 지원하기"), 요청 수정/삭제, 상태 전이(PATCH), 목록 페이지네이션·서버 검색은 이번 범위 밖이다.

## 1. 현재 상태와 전환 결정

- `frontend/src/features/requests/data/mock-requests.ts`가 6개의 하드코딩된 구매요청을 내보내고, `/`(`SearchableRequestGrid` 경유), `/requests`, `/requests/[id]` 세 곳이 전부 이 배열을 직접 import해서 렌더링한다. `/requests/[id]`는 `generateStaticParams`로 mock id만 정적 생성한다.
- 백엔드에는 구매요청을 위한 테이블·API가 전혀 없다. `backend/app/api/router.py`에는 `auth_router`와 `/health`만 등록되어 있고, `backend/app/repositories`, `backend/app/schemas`, `backend/app/services`에도 구매요청 관련 모듈이 없다.
- 인증은 `02-auth-api-implementation-design.md`에서 정의한 FastAPI 자체 세션(`gm_session` 쿠키, `app_users`/`auth_sessions` 테이블)만 존재한다. 구매요청 작성자는 이 세션의 사용자로 식별한다.
- 전환 후 `mock-requests.ts`는 삭제하고, 목록·상세·홈 화면은 신규 `GET /api/requests`, `GET /api/requests/{id}`만을 데이터 소스로 사용한다. 로그인한 사용자는 `/requests/new`에서 새 구매요청을 등록할 수 있고, 등록된 요청은 `모집중` 상태로 즉시 목록에 노출된다.

## 2. 데이터 모델

`backend/supabase/migrations/<timestamp>_create_purchase_requests.sql` (신규 forward migration, 기존 마이그레이션은 수정하지 않는다):

```sql
create table public.purchase_requests (
  id uuid primary key,
  requester_id uuid not null references public.app_users(id),
  title text not null,
  category text not null,
  desired_price integer not null,
  description text not null,
  status text not null default '모집중',
  created_at timestamptz not null default timezone('utc', now()),
  constraint purchase_requests_title_length check (char_length(trim(title)) between 2 and 80),
  constraint purchase_requests_category_allowed check (
    category in ('디지털기기', '가구/인테리어', '게임/취미', '스포츠/레저', '생활가전', '기타')
  ),
  constraint purchase_requests_desired_price_range check (desired_price > 0 and desired_price <= 100000000),
  constraint purchase_requests_description_length check (char_length(trim(description)) between 10 and 2000),
  constraint purchase_requests_status_allowed check (status in ('모집중', '협의중', '마감'))
);

create index purchase_requests_created_at_idx on public.purchase_requests (created_at desc);

alter table public.purchase_requests enable row level security;
revoke all on table public.purchase_requests from anon, authenticated;
```

- `app_users`와 동일하게 RLS는 켜두되 `anon`/`authenticated`에 권한을 주지 않는다. FastAPI가 전용 DB 자격증명으로만 읽고 쓰며, 브라우저의 직접 PostgREST 접근은 없다.
- `id`는 `app_users.id`와 동일하게 애플리케이션이 `uuid4()`로 생성해 삽입한다(DB default 없음).
- 카테고리 목록은 기존 mock 데이터의 5개 카테고리(`디지털기기`, `가구/인테리어`, `게임/취미`, `스포츠/레저`, `생활가전`)에 분류 불가 항목을 위한 `기타`를 더해 6개로 고정한다. 이 목록이 이번 스펙의 유일한 권위이며, 프런트 select와 DB check 제약이 동일한 배열을 참조해야 한다.
- `requester_id`는 응답 스키마에는 노출하지 않는다(추후 "내 요청" 기능에서 필요할 때 별도 스펙으로 노출 여부를 정한다). 소유권 데이터는 DB에만 저장한다.

## 3. HTTP 계약

모든 요청/응답 본문은 JSON이며 `Content-Type: application/json`이다. 정렬은 `created_at desc`(최신 등록이 먼저) 고정이다.

### `POST /api/requests` (로그인 필요)

요청:

```json
{
  "title": "아이폰 14 프로 128GB 자급제",
  "category": "디지털기기",
  "desiredPrice": 750000,
  "description": "상태 좋은 자급제 찾습니다. 딥퍼플 선호합니다."
}
```

| 상태 | 응답 | 의미 |
| --- | --- | --- |
| 201 | `{ "id", "title", "category", "desiredPrice", "status": "모집중", "description", "createdAt" }` | 생성 완료. `status`는 클라이언트 입력을 무시하고 서버가 항상 `모집중`으로 설정한다. |
| 400 | `{ "code": "invalid_input", "message": "..." }` | title/category/desiredPrice/description 검증 실패 |
| 401 | `{ "code": "authentication_required", "message": "로그인이 필요해요." }` | `gm_session` 쿠키가 없거나 무효/만료 |

### `GET /api/requests` (공개)

| 상태 | 응답 | 의미 |
| --- | --- | --- |
| 200 | `[{ "id", "title", "category", "desiredPrice", "status", "description", "createdAt" }, ...]` | 전체 목록. 데이터가 없으면 빈 배열 `[]`. 이번 범위에는 페이지네이션이 없다(목록이 커지면 후속 스펙에서 다룬다). |

### `GET /api/requests/{id}` (공개)

| 상태 | 응답 | 의미 |
| --- | --- | --- |
| 200 | 위 단건 객체 | 존재하는 요청 |
| 404 | `{ "code": "not_found", "message": "구매요청을 찾을 수 없어요." }` | id가 없거나 형식이 UUID가 아님 |

## 4. 인증·검증·보안

- `POST /api/requests`는 `auth.py`와 동일한 방식으로 `gm_session` 쿠키를 읽어 `AuthService`(또는 재사용 가능한 세션 조회 함수)로 유효성을 검증한다. 세션이 없거나 만료/폐기됐으면 401 `authentication_required`를 반환하고 행을 생성하지 않는다.
- 서버는 `title`(trim 후 2~80자), `category`(고정 6개 값 중 하나), `desiredPrice`(1 이상 100,000,000 이하 정수), `description`(trim 후 10~2000자)을 검증한다. 클라이언트 검증은 UX용 보조 수단일 뿐이며, 서버 검증이 최종 권위다(DB check 제약이 최후 방어선).
- 요청 본문에 `status`나 `requesterId`가 포함돼도 무시한다. `status`는 항상 서버가 `모집중`으로 고정하고, 작성자는 세션에서 조회한 사용자 id로만 채운다.
- `purchase_requests` 조회/생성은 `app_users`/`auth_sessions`와 같은 전용 DB 자격증명을 쓰는 repository 계층을 통해서만 이뤄진다. `DATABASE_URL` 미설정 시 로컬 개발/계약 테스트를 위해 `InMemoryPurchaseRequestRepository`를 두고, 설정 시 `PostgresPurchaseRequestRepository`를 쓰는 기존 `users.py`/`sessions.py` 패턴을 그대로 따른다.

## 5. 프론트엔드 동작

- **목록/상세/홈 데이터 소스 전환**: `frontend/src/features/requests/data/mock-requests.ts`를 삭제하고, 같은 위치에 `requests-api.ts`(가칭)를 신설해 서버 컴포넌트에서 same-origin `/api/requests`(+`/api/requests/{id}`)를 fetch하는 함수를 제공한다. `/`(`app/page.tsx`), `/requests`(`app/requests/page.tsx`), `/requests/[id]`가 이 함수만 사용하도록 바꾼다.
  - `next.config.ts`의 rewrite에 `/api/requests/:path*` → `${backendApiUrl}/api/requests/:path*`를 추가해 `/api/auth/:path*`와 동일하게 same-origin으로 노출한다.
- **목록 빈 상태**: 등록된 요청이 하나도 없으면 `/requests`와 `SearchableRequestGrid`는 "아직 등록된 구매요청이 없어요. 첫 요청을 등록해보세요!" 같은 안내와 `/requests/new` 링크를 보여준다(더 이상 항상 6개가 채워져 있다고 가정하지 않는다).
- **상세 페이지**: `generateStaticParams`(mock id 기반 정적 생성)를 제거하고 동적으로 `GET /api/requests/{id}`를 호출한다. 404면 기존과 동일하게 `notFound()`로 처리한다. "이 요청에 지원하기" 버튼은 지금처럼 비활성 상태를 유지한다(판매자 지원은 이번 범위 밖).
- **등록 진입점**: `frontend/src/components/layout/Header.tsx`의 `primaryLinks` 오른쪽에 "구매요청 등록" CTA 링크를 추가해 `/requests/new`로 보낸다(로그인 여부와 무관하게 항상 노출; 인증 게이트는 진입 후 페이지가 처리한다). `/requests` 목록 페이지 상단에도 동일한 CTA를 둔다.
- **`/requests/new` 페이지**: 서버 컴포넌트가 `auth.ts`의 `getSameOriginAuthRequest`/쿠키 전달 패턴을 재사용해 `GET /api/auth/me`로 세션을 확인한다. 비로그인이면 `/login?next=/requests/new`로 redirect한다(`LoginForm`이 이미 지원하는 안전한 내부 `next` 처리와 동일한 규칙 사용).
- **등록 폼**: `title`(text), `category`(고정 6개 값 select), `desiredPrice`(number, 원 단위), `description`(textarea) 네 필드만 받는다. 클라이언트 측에서 2절의 범위와 동일한 최소 검증을 먼저 수행해 즉시 오류 메시지를 보여주고, 통과하면 `frontend/src/features/requests/actions/requests.ts`의 서버 액션(`createRequest`, `signUp`/`signIn`과 동일한 형태의 same-origin fetch + 쿠키 전달)이 `POST /api/requests`를 호출한다.
  - 201: 새로 생성된 `id`로 `/requests/{id}`로 이동.
  - 400: 어떤 필드가 문제인지 폼 필드 옆에 표시.
  - 401(세션 만료 등 경합 상황): `/login?next=/requests/new`로 redirect.

## 6. 정확한 변경 대상

| 구분 | 파일 | 작업 |
| --- | --- | --- |
| DB | `backend/supabase/migrations/<timestamp>_create_purchase_requests.sql` | `purchase_requests` 테이블·제약·인덱스·RLS 추가 (신규 forward migration) |
| Backend | `backend/app/schemas/requests.py` | `CreateRequestInput`, `PurchaseRequestOut`, `ApiError` 재사용/정의 |
| Backend | `backend/app/repositories/requests.py` | `PurchaseRequestRepository` Protocol + `InMemory`/`Postgres` 구현 (`users.py`/`sessions.py` 패턴) |
| Backend | `backend/app/services/requests.py` | 생성/목록/단건 조회 유스케이스, 세션 검증 연동 |
| Backend | `backend/app/api/requests.py` | `requests_router`: POST `/requests`, GET `/requests`, GET `/requests/{id}` |
| Backend | `backend/app/api/router.py` | `requests_router` 등록 |
| Frontend | `frontend/next.config.ts` | `/api/requests/:path*` rewrite 추가 |
| Frontend | `frontend/src/types/request.ts` | 카테고리 고정 리터럴 유니온 반영(2절 6개 값과 동일하게) |
| Frontend 신규 | `frontend/src/features/requests/data/requests-api.ts` | same-origin `GET /api/requests`, `GET /api/requests/{id}` 서버 fetch 함수 |
| Frontend 신규 | `frontend/src/features/requests/actions/requests.ts` | `createRequest` 서버 액션 (`auth.ts` 패턴) |
| Frontend 신규 | `frontend/src/features/requests/lib/request-input.ts` | 폼 파싱·클라이언트 검증, 카테고리 상수 export |
| Frontend 신규 | `frontend/src/features/requests/components/RequestForm.tsx` | 등록 폼 UI |
| Frontend 신규 | `frontend/src/app/requests/new/page.tsx` | 인증 게이트 + `RequestForm` 렌더 |
| Frontend 수정 | `frontend/src/app/page.tsx`, `frontend/src/app/requests/page.tsx`, `frontend/src/app/requests/[id]/page.tsx` | mock import 제거, `requests-api.ts` 사용, 빈 상태 처리, `generateStaticParams` 제거 |
| Frontend 수정 | `frontend/src/features/requests/components/SearchableRequestGrid.tsx` | mock 대신 실데이터 배열을 props로 받도록 유지(구조 변경 최소화) |
| Frontend 수정 | `frontend/src/components/layout/Header.tsx` | "구매요청 등록" CTA 추가 |
| Frontend 삭제 | `frontend/src/features/requests/data/mock-requests.ts` | 시드 샘플 데이터 제거 |
| 테스트(별도 RED 작업) | `backend/tests/test_requests.py`, `frontend/tests/features/requests/*.test.ts(x)`, `frontend/tests/app/requests-*.test.tsx` | 신규 계약을 먼저 검증 (아래 수용 기준 1:1 대응) |

## 7. 구현 순서

1. DB migration과 backend contract(schemas/repositories/services/api)를 구현하고, 인증 없는 생성이 401로 막히는지, 빈 목록이 `[]`인지 확인한다.
2. frontend를 실데이터 fetch로 전환하고 `/requests/new` 폼·서버 액션·인증 게이트를 구현한 뒤 `mock-requests.ts`를 삭제한다.
3. 아래 수용 기준을 자동 테스트로 확인한다.

## 8. 수용 기준

1. `frontend/src/features/requests/data/mock-requests.ts`가 저장소에서 삭제되어 있고, 어떤 컴포넌트도 이를 import하지 않는다.
2. `/`, `/requests`, `/requests/[id]`가 `GET /api/requests`(`/{id}`) 응답만으로 렌더링되며, 시드 데이터 없이 백엔드가 빈 배열을 반환하면 세 화면 모두 빈 상태 UI(등록 유도 문구 + `/requests/new` 링크)를 보여준다.
3. 비로그인 사용자가 `/requests/new`에 접근하거나 Header/목록의 "구매요청 등록" CTA를 누르면 `/login?next=/requests/new`로 리다이렉트되고, 로그인 성공 후 다시 해당 폼으로 돌아온다.
4. 로그인한 사용자가 유효한 값(title 2~80자, 고정 6개 카테고리 중 하나, desiredPrice 1~100,000,000 정수, description 10~2000자)으로 폼을 제출하면 `POST /api/requests`가 201을 반환하고, `/requests/{새 id}`로 이동하며, 해당 요청이 `/requests` 목록 맨 위(최신순)에 나타난다.
5. title 미입력/2자 미만, category 목록 밖 값, desiredPrice가 0 이하이거나 100,000,000 초과, description 10자 미만 중 하나라도 있으면 클라이언트가 제출 전에 필드 오류를 보여주고, 이를 우회해 직접 호출해도 서버가 400 `invalid_input`으로 거부하며 행을 생성하지 않는다.
6. `gm_session` 쿠키가 없거나 만료/폐기된 상태로 `POST /api/requests`를 호출하면 401 `authentication_required`를 반환하고 DB에 행이 생기지 않는다.
7. 생성 요청 본문에 `status`나 `requesterId`를 포함해 보내도 무시되며, 새 요청은 항상 `status: "모집중"`으로 생성된다.
8. 존재하지 않거나 UUID 형식이 아닌 id로 `GET /api/requests/{id}`를 호출하면 404 `not_found`를 반환하고, `/requests/[id]` 페이지는 Next.js `notFound()` UI를 렌더링한다.
9. `purchase_requests` 마이그레이션은 RLS가 켜져 있고 `anon`/`authenticated`에 권한을 부여하지 않는다(`app_users`와 동일한 격리를 migration 리뷰 또는 `get_advisors`로 확인).
10. 생성된 행은 DB에 `requester_id`로 작성자의 `app_users.id`를 저장한다(공개 API 응답에는 노출하지 않되, 백엔드 테스트에서 repository/DB 조회로 검증 가능해야 한다).
