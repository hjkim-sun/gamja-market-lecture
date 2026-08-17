# 14. 구매요청/판매 지원 사진 업로드 (Supabase Storage) 설계

> 범위: 구매요청 작성자가 요청 등록 시 참고 사진을 첨부하고, 판매자가 지원 시 보유 상품 사진을 첨부해 구매요청 상세·지원자 목록·내 지원 목록 화면에서 사진을 볼 수 있게 하는 기능. 사진 교체/삭제, 순서 재배치 UI, 라이트박스/확대보기, 요청 본문 수정(사진 재업로드 재시도 포함)은 이번 범위 밖이며 후속 스펙에서 다룬다.

## 1. 현재 상태와 전환 결정

- `purchase_requests`(`08-purchase-request-registration-design.md`)와 `request_applications`(`11-...design.md`)는 텍스트 필드만 가진다. 사진 컬럼·테이블은 전혀 없다.
- 백엔드는 Postgres에 접근할 때 Supabase PostgREST/클라이언트를 전혀 쓰지 않는다 — `DATABASE_URL`로 직접 `psycopg` 연결을 맺고, `anon`/`authenticated`에는 모든 테이블 권한을 `revoke`한다(`app_users`, `purchase_requests`, `request_applications` 등 기존 마이그레이션 전부 동일). 즉 **브라우저는 어떤 테이블에도 직접 쓰지 못하고, FastAPI만 데이터를 쓴다.** 이 원칙을 Storage에도 그대로 확장한다: 브라우저는 Supabase Storage에 직접 업로드하지 않고, FastAPI가 서비스 롤 자격증명으로 업로드를 대행한다.
- 이 결정은 인증 구조에서도 강제된다. 프런트엔드의 `createClient()`(`frontend/src/lib/supabase/client.ts`, `server.ts`)는 Supabase Auth(`auth.users`/`profiles`, `20260816121000_create_profiles_auth_layer.sql`)용이며, 이메일 인증 콜백(`frontend/src/app/auth/callback/route.ts`)에만 쓰인다. 실제 로그인·세션(`gm_session` 쿠키, `app_users`/`auth_sessions`)은 이 Supabase Auth 세션과 무관한 애플리케이션 자체 인증이다. 따라서 로그인한 사용자 대부분은 브라우저에 유효한 Supabase Auth JWT가 없고, `auth.uid()` 기반 Storage RLS 정책(`storage.objects` insert policy)으로 "본인 소유 경로에만 업로드 허용"을 구현할 수 없다. **파일을 서버가 대신 받아 올리는 구조가 이 코드베이스에서 유일하게 성립하는 선택지다.**
- 구매요청은 로그인 없이도 전체가 공개된다(`GET /api/requests`, `GET /api/requests/{id}` 모두 인증 불필요). 반면 지원 내역은 요청 작성자(`GET /api/requests/{id}/applications`)와 지원한 판매자 본인(`GET /api/applications/mine`)만 볼 수 있다. 이 비대칭을 사진에도 그대로 반영한다: **요청 사진은 공개 버킷(public URL)**, **지원 사진은 비공개 버킷(서버가 매 응답마다 서명된 URL을 발급)**으로 나눈다.
- 사진 업로드는 텍스트 생성과 **별도의 후속 호출**로 처리한다. `POST /api/requests`(JSON)와 `POST /api/requests/{id}/applications`(JSON)의 기존 계약은 손대지 않고, 생성 성공 후 반환된 id로 새 멀티파트 엔드포인트를 호출해 사진을 붙인다. 이유: (1) 기존 스키마·테스트·서버 액션을 깨지 않는다, (2) 텍스트 검증 실패와 파일 검증 실패를 분리해 각각 명확한 오류를 보여줄 수 있다, (3) `frontend/next.config.ts`의 rewrite(`/api/requests/:path*`, `/api/applications/:path*`)와 `same-origin-request.ts`의 경로 화이트리스트가 이미 하위 경로를 모두 허용하므로 **프런트엔드 라우팅 설정은 한 줄도 바꾸지 않아도 된다.**
- 요청/지원 생성에는 편집(수정) 화면이 없다. 사진 첨부도 동일한 전제를 따른다: 생성 직후에만 첨부할 수 있고, 이후 추가·교체·삭제 API는 이번 스펙에 없다(7절 "범위 밖" 참고). 업로드는 낙관적이다 — 텍스트 생성이 이미 커밋된 뒤에 사진 업로드가 실패해도 요청/지원 자체는 유효하며, 사용자에게는 경고만 보여주고 정상 흐름대로 상세 페이지로 이동한다(6.6절).

## 2. 데이터 모델

세 개의 신규 forward migration을 추가한다(기존 마이그레이션 수정 없음). 파일명은 `backend/supabase/migrations/<timestamp>_*.sql` 패턴을 따른다.

### 2.1 Storage 버킷 (`..._create_image_storage_buckets.sql`)

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'request-images', 'request-images', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'application-images', 'application-images', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- storage.objects는 Supabase 프로젝트 기본값으로 이미 RLS가 켜져 있다. anon/authenticated에
-- 대한 insert/update/delete 정책을 하나도 만들지 않는다 — 이 두 버킷에는 서비스 롤(FastAPI)만
-- 쓸 수 있고, 서비스 롤은 RLS를 우회하므로 정책이 없어도 백엔드 업로드는 그대로 동작한다.
-- request-images는 `public = true`이므로 GET은 /storage/v1/object/public/... 경로로 RLS를
-- 우회해 공개 서빙된다. application-images는 `public = false`이고 정책도 없으므로 서명된
-- URL(백엔드가 서비스 롤로 발급) 없이는 브라우저에서 절대 읽을 수 없다.
```

- `file_size_limit`(바이트) · `allowed_mime_types`는 Storage가 업로드 시점에 한 번 더 강제하는 서버 측 최종 방어선이다 — FastAPI의 애플리케이션 검증(5절)이 우회되더라도 Storage API 자체가 5MB 초과/허용 외 MIME을 거부한다.
- 버킷 정책은 기존 테이블의 `enable row level security` + `revoke all on ... from anon, authenticated` 철학을 Storage 계층에 그대로 옮긴 것이다: 정책을 "허용"으로 추가하는 대신 아무 정책도 만들지 않아 기본값(거부)을 유지하고, 유일한 예외(공개 읽기)는 정책이 아니라 버킷의 `public` 플래그로 명시적으로 연다.

### 2.2 `request_images` (`..._create_request_images.sql`)

```sql
create table public.request_images (
  id uuid primary key,
  request_id uuid not null references public.purchase_requests(id),
  storage_path text not null,
  sort_order smallint not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint request_images_unique_slot unique (request_id, sort_order),
  constraint request_images_sort_order_range check (sort_order between 0 and 4),
  constraint request_images_storage_path_not_blank check (char_length(trim(storage_path)) > 0)
);

create index request_images_request_id_idx on public.request_images (request_id, sort_order asc);

alter table public.request_images enable row level security;
revoke all on table public.request_images from anon, authenticated;
```

### 2.3 `application_images` (`..._create_application_images.sql`)

```sql
create table public.application_images (
  id uuid primary key,
  application_id uuid not null references public.request_applications(id),
  storage_path text not null,
  sort_order smallint not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint application_images_unique_slot unique (application_id, sort_order),
  constraint application_images_sort_order_range check (sort_order between 0 and 4),
  constraint application_images_storage_path_not_blank check (char_length(trim(storage_path)) > 0)
);

create index application_images_application_id_idx on public.application_images (application_id, sort_order asc);

alter table public.application_images enable row level security;
revoke all on table public.application_images from anon, authenticated;
```

- **사진 개수 상한(5장)을 DB 레벨에서 강제하는 방법**: `sort_order`를 0~4로 제한하고 `(request_id, sort_order)`/`(application_id, sort_order)`를 유니크로 걸었다. 슬롯이 5개(0,1,2,3,4)뿐이므로 6번째 삽입은 CHECK 위반이 아니라 "채울 수 있는 `sort_order` 값이 없다"는 애플리케이션 로직으로 막힌다(6.5절) — `request_applications_unique_seller_per_request`가 그랬듯, 애플리케이션 계층 검증이 1차 방어, 유니크 제약이 최종 방어라는 기존 패턴과 동일하다.
- `storage_path`만 저장하고 URL 전체는 저장하지 않는다. 공개 URL(요청 사진)은 `storage_path`로부터 결정적으로 조립할 수 있고, 서명 URL(지원 사진)은 만료가 있어 저장해봐야 곧 무효화되므로 항상 응답 시점에 새로 발급한다(3절).
- `request_images`/`application_images`는 `chat_threads`가 `request_id`를 중복 저장한 것과 달리 부모 id 하나만 가진다 — 사진은 항상 부모(요청/지원)를 통해서만 조회되고 독립적으로 조회될 일이 없기 때문이다.

## 3. Storage 계층 설계

### 3.1 경로 규칙

```
request-images/{requestId}/{imageId}.{ext}
application-images/{applicationId}/{imageId}.{ext}
```

- `imageId`는 `request_images.id`/`application_images.id`(서버가 생성하는 `uuid4()`)와 동일한 값을 재사용한다 — 파일 경로와 메타데이터 행을 1:1로 대응시켜 별도 매핑 없이 추적 가능하게 한다.
- `ext`는 **클라이언트가 보낸 파일명이 아니라 서버가 감지한 실제 이미지 포맷**에서 도출한다(`jpg`/`png`/`webp`). 사용자 파일명은 저장 경로 어디에도 쓰지 않는다 — 경로 주입·특수문자·중복 파일명 충돌을 원천 차단한다.
- 부모 id를 경로 프리픽스로 두면 "이 요청/지원의 사진 전부"를 접두어로 나열할 수 있어 향후 일괄 삭제(요청 삭제 기능이 생길 때) 구현이 쉬워진다(현재는 삭제 기능이 없으므로 이번 스펙에서 구현하지 않는다).

### 3.2 서버-Storage 통신

- 백엔드는 `supabase-py`/`storage3`를 추가하지 않고, Storage HTTP API를 `httpx`(이미 dev 의존성으로 있음 → `dependencies`로 승격)로 직접 호출하는 얇은 래퍼 `backend/app/core/storage.py`를 새로 둔다. 이유: 이 백엔드는 이미 Postgres도 ORM 없이 `psycopg` 원시 SQL로 직접 다루는 스타일이라(`repositories/requests.py`), 무거운 SDK 대신 REST 호출 하나로 충분한 최소 의존성 스타일과 맞는다.
- 신규 환경변수(백엔드 전용, `backend/.env.example`에 추가):
  - `SUPABASE_URL` — 프로젝트 URL(프런트의 `NEXT_PUBLIC_SUPABASE_URL`과 같은 값이지만 별도 변수로 백엔드에도 둔다 — 프런트 전용 `NEXT_PUBLIC_*`를 백엔드가 가져다 쓰지 않는다).
  - `SUPABASE_SERVICE_ROLE_KEY` — RLS를 우회하는 비밀 키. **절대 프런트엔드/브라우저로 내려가지 않는다.** `frontend/.env.example`의 "publishable key만 쓰라"는 기존 주석과 대칭되는 백엔드 쪽 원칙으로 문서화한다.
- 업로드: `POST {SUPABASE_URL}/storage/v1/object/{bucket}/{path}`, 헤더 `Authorization: Bearer {SERVICE_ROLE_KEY}`, `apikey: {SERVICE_ROLE_KEY}`, `Content-Type: {감지된 MIME}`, 바디는 5절에서 정제(재인코딩)된 이미지 바이트.
- 공개 URL(요청 사진) 조립: `{SUPABASE_URL}/storage/v1/object/public/request-images/{path}` — HTTP 호출 없이 문자열로 구성한다(버킷이 `public = true`이므로 항상 유효).
- 서명 URL(지원 사진) 발급: `POST {SUPABASE_URL}/storage/v1/object/sign/application-images/{path}` (`{"expiresIn": 300}`), 서비스 롤 인증으로 호출해 응답의 `signedURL`을 그대로 내려준다. **TTL 300초, 절대 캐시/저장하지 않고 매 응답마다 새로 발급한다** — `OwnerApplicationOut`/`MyApplicationOut` 직렬화 시점에 이미지별로 호출한다.
- `DATABASE_URL`이 없을 때(로컬 계약 테스트) `PurchaseRequestRepository`가 `InMemory` 구현으로 대체되듯, Storage 클라이언트도 `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` 미설정 시 실제 HTTP 호출 없이 메모리에 바이트를 보관하고 결정적인 가짜 URL(`memory://request-images/...`)을 돌려주는 `InMemoryImageStorage`를 둔다 — 기존 `InMemoryPurchaseRequestRepository` 패턴과 동일하게 로컬 개발·contract 테스트가 실제 Supabase 프로젝트 없이 동작하게 한다.

## 4. HTTP 계약

멀티파트 요청은 `Content-Type: multipart/form-data`, 필드명 `images`(파일 여러 개, FastAPI `list[UploadFile] = File(...)`). 그 외 계약 스타일(camelCase alias, `gm_session` 쿠키, `ApiError{code,message}`)은 기존과 동일하다.

### 4.1 `POST /api/requests/{id}/images` (요청 작성자 전용)

`requests_router`(prefix `/requests`)에 추가한다.

요청: `multipart/form-data`, `images` 필드에 1~5개 파일.

| 상태 | 응답 | 의미 |
| --- | --- | --- |
| 201 | `{ "images": [{ "id", "url", "sortOrder" }, ...] }` | 새로 추가된 사진만 반환(기존 사진 포함 전체 목록 아님), `sortOrder` 오름차순 |
| 400 | `ApiError{code:"invalid_image"}` | 허용 MIME이 아니거나, 손상되어 디코딩할 수 없거나, 개별 파일이 5MB 초과 |
| 400 | `ApiError{code:"no_files"}` | `images` 필드가 비어 있음 |
| 401 | `ApiError{code:"authentication_required"}` | 세션 없음/만료 |
| 403 | `ApiError{code:"not_request_owner"}` | 요청 작성자가 아닌 로그인 사용자 |
| 404 | `ApiError{code:"not_found"}` | 요청 id 없음 |
| 409 | `ApiError{code:"image_limit_exceeded"}` | 기존 사진 수 + 이번 요청 파일 수가 5장을 초과 |

### 4.2 `POST /api/applications/{applicationId}/images` (지원한 판매자 본인 전용)

`applications_router`(prefix `/applications`)에 추가한다.

요청: 4.1과 동일한 멀티파트 형식.

| 상태 | 응답 | 의미 |
| --- | --- | --- |
| 201 | `{ "images": [{ "id", "url", "sortOrder" }, ...] }` | `url`은 300초 서명 URL |
| 400 | `ApiError{code:"invalid_image"}` / `ApiError{code:"no_files"}` | 4.1과 동일 |
| 401 | `ApiError{code:"authentication_required"}` | 세션 없음 |
| 403 | `ApiError{code:"not_application_owner"}` | 지원을 등록한 판매자 본인이 아님(요청 작성자여도 업로드는 못 함 — 업로드는 지원자만) |
| 404 | `ApiError{code:"not_found"}` | 지원 id 없음 |
| 409 | `ApiError{code:"image_limit_exceeded"}` | 4.1과 동일 |

### 4.3 기존 응답에 `images` 필드 추가 (신규 필드, 하위 호환 추가)

| 스키마 | 위치 | 추가 필드 |
| --- | --- | --- |
| `PurchaseRequestOut` | `GET /api/requests`, `GET /api/requests/{id}`(상속) | `images: [{ id, url, sortOrder }]` — `request-images` 공개 URL, 항상 포함(로그인 불필요) |
| `MyPurchaseRequestOut` | `GET /api/requests/mine` | 위와 동일(상속) |
| `OwnerApplicationOut` | `GET /api/requests/{id}/applications` | `images: [{ id, url, sortOrder }]` — `application-images` 서명 URL, 요청 작성자만 호출 가능하므로 이 응답에서만 노출 |
| `MyApplicationOut` | `GET /api/applications/mine` | 위와 동일, 지원한 판매자 본인만 |
| `ApplicationOut` | `POST /api/requests/{id}/applications`, `PATCH /api/applications/{id}` | `images: []` 고정(생성/수락·거절 응답 시점에는 아직 사진이 없거나 이 응답에서 조회하지 않는다 — 사진은 4.2 호출 이후 `GET /api/applications/mine` 등에서 확인) |

`RequestImageOut { id: UUID, url: str, sortOrder: int }` / `ApplicationImageOut`도 동일한 모양이지만 스키마 파일을 분리해(`schemas/requests.py`/`schemas/applications.py`) 각자의 URL 발급 방식(공개 vs 서명) 차이를 코드 레벨에서도 구분한다.

## 5. 유효성 검증 (파일 내용)

서버 검증이 최종 권위라는 기존 원칙(`AGENTS.md`에 명시된 TDD 원칙과 동일 선상)을 그대로 따른다 — 클라이언트 `accept`/`File.type`은 사용자 경험을 위한 힌트일 뿐 신뢰하지 않는다.

1. **개수**: 파일 수는 요청당 1~5개, 기존에 이미 저장된 개수와 합쳐 5개를 넘으면 6번째 파일 전부를 거부(부분 성공 없음 — 트랜잭션 전체를 409로 실패시킨다).
2. **크기**: 파일당 5MB(Storage 버킷의 `file_size_limit`과 동일한 값을 애플리케이션에서도 먼저 검사해 더 친절한 오류 메시지를 준다).
3. **포맷 판별**: `UploadFile.content_type`(클라이언트 선언)이 아니라 **매직 바이트로 실제 포맷을 감지**한다(JPEG `FF D8 FF`, PNG `89 50 4E 47`, WEBP `RIFF....WEBP`). 감지 실패(둘 다 아님) → 400 `invalid_image`.
4. **디코딩 검증 + 정제(sanitize)**: Pillow(`pillow>=11,<12`, 신규 의존성)로 실제 픽셀까지 디코딩해본다 — 매직 바이트는 맞지만 내부가 손상/조작된 파일을 걸러낸다. 디코딩에 성공하면:
   - `ImageOps.exif_transpose`로 EXIF 방향 정보를 픽셀에 반영한 뒤 **EXIF 메타데이터(위치정보 GPS 태그 포함)를 제거**하고 재인코딩한다 — 사용자가 촬영 장소를 의도치 않게 노출하지 않도록 하는 개인정보 보호 조치.
   - 긴 변이 1600px를 넘으면 비율을 유지해 1600px로 축소한다(저장 용량·전송 비용 억제, 상품 확인 용도로는 1600px면 충분).
   - JPEG는 품질 85로, PNG/WEBP는 무손실로 재인코딩한다.
   - **Storage에는 항상 이 정제된 바이트를 올린다 — 사용자가 올린 원본 바이트를 그대로 저장하지 않는다.**
5. 위 1~4 중 하나라도 실패하면 **해당 호출의 파일을 하나도 저장하지 않는다**(부분 업로드 금지 — 응답의 `images`가 요청한 파일 수와 항상 일치하거나, 전체가 400/409로 실패한다). 이는 `sort_order`가 파일 배열 순서와 어긋나는 상태를 방지하기 위함이다.
6. 파일명·`Content-Disposition`의 사용자 입력은 어디에도 저장/로그하지 않는다(3.1절의 경로 규칙 참고).

## 6. 인증·권한·동시성

- 두 엔드포인트 모두 기존 패턴대로 `gm_session` 쿠키를 `AuthService.me()`로 검증한다. `InvalidSessionError` → 401 `authentication_required`.
- **요청 사진 업로드 권한**: 세션 사용자 `== purchase_requests.requester_id`. 불일치 시 403 `not_request_owner`(`10-request-detail-owner-application-guard.md`의 `isOwner` 판단과 동일한 비교를 재사용).
- **지원 사진 업로드 권한**: 세션 사용자 `== request_applications.seller_id`. 요청 작성자 본인이라도 지원 사진은 올릴 수 없다(작성자는 조회만 가능) — 403 `not_application_owner`(신규 예외 클래스, `NotRequestOwnerError`와 대칭되는 이름).
- 상태(`모집중`/`협의중`/`마감`, `대기중`/`수락됨`/`거절됨`)로 업로드를 막지 않는다 — 텍스트 필드(제목·설명·메시지)도 생성 후 수정 기능이 없어 상태 전이와 무관하게 항상 조회 가능한 것과 동일하게, 사진도 한 번 첨부되면 상태와 무관하게 유지되는 데이터로 다룬다.
- **동시성(슬롯 경쟁)**: 같은 요청/지원에 동시에 두 번의 업로드 호출이 들어오면 둘 다 "현재 개수"를 먼저 읽고 `sort_order`를 정하려 하므로 경쟁이 생길 수 있다. `11-...design.md`의 수락 트랜잭션과 동일한 해법을 쓴다 — 삽입 전에 부모 행(`purchase_requests`/`request_applications`)을 `SELECT ... FOR UPDATE`로 잠근 뒤 같은 트랜잭션 안에서 현재 `count`/`max(sort_order)`를 다시 읽고 `sort_order`를 배정, 이미지 행들을 삽입, 커밋한다. 이렇게 하면 동시 업로드가 같은 슬롯을 두 번 차지하는 경쟁을 막고, 유니크 제약(2.2/2.3절)이 혹시 놓친 경우의 최종 방어선이 된다.
- **Storage 업로드 순서**: DB 트랜잭션보다 Storage 업로드를 먼저 수행한다(정제된 바이트를 먼저 올리고, 성공한 경로들만 모아 위 트랜잭션으로 메타데이터 행을 삽입). Storage 업로드가 일부만 성공하고 DB 트랜잭션이 실패(예: 슬롯 경쟁 후 재확인에서 5장 초과 발견)하면, 이미 올라간 Storage 객체는 고아로 남는다 — 이번 스펙에서는 이를 수용 가능한 트레이드오프로 두고 정리(orphan cleanup) 배치는 범위 밖으로 남긴다(7절).
- **이미지 조회 시점 권한**: `OwnerApplicationOut`(작성자 전용 응답)과 `MyApplicationOut`(지원자 전용 응답)에만 서명 URL을 내려준다는 사실 자체가 접근 통제다 — 두 엔드포인트는 이미 3절/4절 기준으로 소유자 검증을 거친 뒤에만 이 DTO를 만들므로, 서명 URL 발급 시점에 별도 권한 검사를 반복할 필요는 없다(단, 발급은 반드시 이 검증을 통과한 응답 조립 경로 안에서만 호출되어야 한다 — 다른 경로에서 재사용 금지).
- **생성 실패의 비파괴성(1절 참고)**: 사진 업로드가 400/409/5xx로 실패해도 이미 커밋된 `purchase_requests`/`request_applications` 행은 롤백하지 않는다. 프런트엔드는 이 실패를 사용자에게 경고로만 보여주고 정상 리다이렉트를 진행한다(6.6절과 대칭되는 서버 쪽 원칙: "사진은 부가 데이터, 텍스트 등록 성공이 우선").

## 7. 프런트엔드 동작 (화면 흐름)

공용 모듈을 새 `frontend/src/features/uploads/`에 둔다 — 요청/지원 두 기능이 동일한 검증 규칙과 업로드 UI를 그대로 재사용하기 때문이다(개수/크기/MIME 규칙이 5절과 완전히 동일).

- `frontend/src/features/uploads/lib/image-input.ts`: `validateImageFiles(files: File[]): { ok: true } | { ok: false; message: string }` — 개수(1~5, 0장은 허용 — 사진은 선택 항목), 크기(파일당 5MB), `File.type`이 `image/jpeg`/`image/png`/`image/webp` 중 하나인지 클라이언트에서 우선 검사(서버 재검증은 5절대로 항상 수행).
- `frontend/src/features/uploads/components/ImagePicker.tsx`: `<input type="file" name="images" multiple accept="image/jpeg,image/png,image/webp">` + 선택한 파일의 로컬 미리보기(`URL.createObjectURL`) 그리드 + 개별 제거 버튼. `RequestForm`/`ApplyForm`에 그대로 삽입한다.
- `frontend/src/features/uploads/data/upload-images.ts`: `uploadImages(endpoint: string, files: File[], cookie: string | null): Promise<{ ok: true; images: UploadedImage[] } | { ok: false; message: string }` — `FormData`에 `images` 필드로 파일을 담아 `fetch(url, { method: "POST", body: formData, headers: cookie ? { Cookie: cookie } : undefined })`로 전송한다(멀티파트이므로 `Content-Type`을 수동 지정하지 않는다 — `fetch`가 boundary를 포함해 자동 설정). `getSameOriginRequest`(기존 유틸, 경로 화이트리스트에 이미 `/api/requests`/`/api/applications` 하위 전부 포함)를 그대로 재사용한다.

### 7.1 `/requests/new` (`RequestForm.tsx` 수정)

- 설명 필드 아래에 `ImagePicker`를 추가한다(선택 사항, 0장 제출 가능).
- 제출 흐름(`features/requests/actions/requests.ts`의 `createRequest` 서버 액션 확장): ① 기존과 동일하게 텍스트를 `POST /api/requests`(JSON)로 생성 → 201에서 `id` 획득. ② 사진이 1장 이상 선택돼 있으면 `uploadImages('/api/requests/{id}/images', files, cookie)` 호출. ③ ②의 성공/실패와 무관하게 `redirect(/requests/{id})`(1절·6절의 "비파괴적 실패" 원칙). ②가 실패하면 `sessionStorage` 등에 경고 메시지를 남겨 상세 페이지 진입 직후 배너로 한 번 보여준다(추가 재시도 UI는 범위 밖 — 배너는 닫으면 사라지는 1회성 알림).
- 401(텍스트 생성 단계)은 기존과 동일하게 `/login?next=/requests/new`로 리다이렉트(사진 업로드 이전이므로 영향 없음).

### 7.2 `/requests/[id]/apply` (`ApplyForm.tsx` 수정)

- 7.1과 동일한 패턴: 메시지 필드 아래 `ImagePicker` 추가, `applyToRequest` 서버 액션이 ① `POST /api/requests/{id}/applications`(JSON) → ② 성공 시 `uploadImages('/api/applications/{applicationId}/images', ...)` → ③ 결과와 무관하게 `/requests/{id}`로 이동.
- 400/403/409(텍스트 생성 단계 오류)는 기존 그대로(사진 업로드를 시도하지 않는다 — 지원 자체가 생성되지 않았으므로).

### 7.3 `/requests` 목록 (`SearchableRequestGrid.tsx` 수정)

- 카드에 `images[0]`(있으면) 썸네일을 표시한다. 사진이 없는 요청은 기존 목업 자산 `frontend/public/gamja-mascot.png`를 중립 placeholder로 사용한다(새 이미지 자산을 추가하지 않고 이미 있는 것을 재사용).

### 7.4 `/requests/mine` (`MyPurchaseRequestOut` 응답 확장 사용)

- 목록 카드에 7.3과 동일한 방식으로 대표 사진(`images[0]`)을 보여준다.

### 7.5 `/requests/[id]` 상세 페이지 (`page.tsx` 수정)

- "상세 설명" 섹션 위(또는 아래)에 사진 그리드를 추가한다. 최대 5장을 2~3열 그리드로 나열하고, 사진이 없으면 섹션 자체를 렌더링하지 않는다(빈 placeholder 박스를 강제로 보여주지 않는다 — 사진은 선택 항목이라는 사실을 UI가 그대로 반영).
- 클릭 시 라이트박스 없이 `<a href={url} target="_blank" rel="noreferrer">`로 원본 크기를 새 탭에서 연다(모달 컴포넌트를 새로 만들지 않는 최소 구현).

### 7.6 `/requests/[id]/applications` (`ApplicationList.tsx` 수정, 작성자 전용)

- 각 지원 카드(판매자 표시이름·제안가·메시지)에 `images`(서명 URL) 썸네일 그리드를 추가한다. 서명 URL은 TTL 300초이므로, 이 페이지가 서버 컴포넌트에서 한 번 렌더링된 뒤 오래 열려 있으면 이미지가 만료돼 깨질 수 있다 — MVP에서는 허용하고(새로고침하면 새 URL로 복구), 자동 재발급/폴링은 범위 밖으로 남긴다.

### 7.7 `/applications/mine` (`MyApplicationList.tsx` 수정)

- 7.6과 동일하게 내가 올린 사진 썸네일을 보여준다(내가 무엇을 제출했는지 확인하는 용도).

## 8. 정확한 변경 대상

| 구분 | 파일 | 작업 |
| --- | --- | --- |
| DB | `backend/supabase/migrations/<ts>_create_image_storage_buckets.sql` | `request-images`(public)·`application-images`(private) 버킷 생성 |
| DB | `backend/supabase/migrations/<ts>_create_request_images.sql` | `request_images` 테이블·제약·인덱스·RLS |
| DB | `backend/supabase/migrations/<ts>_create_application_images.sql` | `application_images` 테이블·제약·인덱스·RLS |
| Backend 설정 | `backend/pyproject.toml` | `httpx`를 `dependencies`로 승격, `pillow>=11,<12` 추가 |
| Backend 설정 | `backend/.env.example` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 추가 |
| Backend 신규 | `backend/app/core/storage.py` | Storage HTTP 래퍼(업로드/공개 URL 조립/서명 URL 발급) + `InMemoryImageStorage` |
| Backend 신규 | `backend/app/services/image_sanitizer.py` | 매직바이트 판별, Pillow 디코딩·EXIF 제거·리사이즈·재인코딩(5절) |
| Backend 신규 | `backend/app/schemas/requests.py`(수정) | `RequestImageOut`, `PurchaseRequestOut`/`MyPurchaseRequestOut`에 `images` 필드 |
| Backend 신규 | `backend/app/schemas/applications.py`(수정) | `ApplicationImageOut`, `OwnerApplicationOut`/`MyApplicationOut`에 `images` 필드 |
| Backend 신규 | `backend/app/repositories/request_images.py` | `RequestImageRepository` Protocol + `InMemory`/`Postgres`(`insert_batch`(트랜잭션+잠금), `list_by_request_ids`) |
| Backend 신규 | `backend/app/repositories/application_images.py` | 위와 동일한 모양의 지원 사진 레포지토리 |
| Backend 신규 | `backend/app/services/requests.py`(수정) | `attach_images` 유스케이스: 소유권 검증 → 정제 → 업로드 → 슬롯 배정·삽입 |
| Backend 신규 | `backend/app/services/applications.py`(수정) | 위와 동일한 지원 사진 유스케이스 + `NotApplicationOwnerError` |
| Backend 수정 | `backend/app/api/requests.py` | `POST /requests/{id}/images` 라우트, 응답 직렬화에 `images` 포함 |
| Backend 수정 | `backend/app/api/applications.py` | `POST /applications/{id}/images` 라우트, `OwnerApplicationOut`/`MyApplicationOut` 직렬화 시 서명 URL 발급 |
| Frontend 신규 | `frontend/src/features/uploads/lib/image-input.ts` | 클라이언트 파일 검증(개수/크기/MIME) |
| Frontend 신규 | `frontend/src/features/uploads/components/ImagePicker.tsx` | 파일 선택 + 로컬 미리보기 + 제거 UI |
| Frontend 신규 | `frontend/src/features/uploads/data/upload-images.ts` | 멀티파트 업로드 공용 함수 |
| Frontend 수정 | `frontend/src/types/request.ts`, `frontend/src/types/application.ts` | `images` 필드 타입 추가 |
| Frontend 수정 | `frontend/src/features/requests/components/RequestForm.tsx`, `frontend/src/features/requests/actions/requests.ts` | `ImagePicker` 삽입, 2단계 제출(7.1절) |
| Frontend 수정 | `frontend/src/features/applications/components/ApplyForm.tsx`, `frontend/src/features/applications/actions/applications.ts` | 위와 동일(7.2절) |
| Frontend 수정 | `frontend/src/features/requests/components/SearchableRequestGrid.tsx` | 대표 사진 썸네일(7.3절) |
| Frontend 수정 | `frontend/src/app/requests/mine/page.tsx` 관련 컴포넌트 | 대표 사진 썸네일(7.4절) |
| Frontend 수정 | `frontend/src/app/requests/[id]/page.tsx` | 사진 그리드 섹션(7.5절) |
| Frontend 수정 | `frontend/src/features/applications/components/ApplicationList.tsx` | 사진 썸네일(7.6절) |
| Frontend 수정 | `frontend/src/features/applications/components/MyApplicationList.tsx` | 사진 썸네일(7.7절) |
| 테스트(별도 RED 작업) | `backend/tests/test_request_images.py`, `backend/tests/test_application_images.py` | 9절 수용 기준에 1:1 대응하는 계약 테스트(검증/권한/동시성/정제 포함) |
| 테스트(별도 RED 작업) | `frontend/tests/features/uploads/*`, 기존 `requests`/`applications` 관련 테스트 확장 | `ImagePicker`/`upload-images`/2단계 제출 흐름/썸네일 렌더링 |

## 9. 구현 순서

1. 마이그레이션 3종(버킷 2개 + 테이블 2개)을 추가하고 `get_advisors`(또는 마이그레이션 리뷰)로 `storage.objects`·신규 테이블의 RLS/권한 격리를 확인한다.
2. `backend/app/core/storage.py`(Storage 클라이언트 + `InMemoryImageStorage`)와 `backend/app/services/image_sanitizer.py`(검증·정제)를 독립적으로 단위 테스트(RED → GREEN)한다 — 이 두 모듈은 HTTP 라우트 없이도 순수하게 테스트 가능하다.
3. 요청 사진 계약(schemas/repositories/services/api)을 구현한다 — 업로드·개수 상한·소유권·동시성 슬롯 배정을 backend 테스트로 먼저 고정한다.
4. 지원 사진 계약을 동일한 패턴으로 구현한다(서명 URL 발급 경로 포함).
5. `PurchaseRequestOut`/`OwnerApplicationOut`/`MyApplicationOut` 등 기존 응답에 `images` 필드를 추가하고, 기존 계약 테스트가 깨지지 않는지(추가 필드이므로 하위 호환) 확인한다.
6. 프런트엔드 공용 업로드 모듈(`features/uploads`)을 구현한다.
7. `RequestForm`/`ApplyForm`의 2단계 제출 흐름을 구현한다.
8. 목록/상세/지원자 목록/내 지원 목록 화면에 썸네일을 반영한다.
9. 10절의 수용 기준을 자동 테스트로 확인한다.

## 10. 수용 기준

1. 로그인한 요청 작성자가 자신이 만든 요청에 1~5장(각 5MB 이하, JPEG/PNG/WEBP)을 업로드하면 201과 함께 생성된 이미지 목록(`sortOrder` 0부터 오름차순)을 반환하고, 이후 `GET /api/requests/{id}`(비로그인 포함)의 `images`에 공개 URL로 나타난다.
2. 허용되지 않는 MIME이거나 매직바이트 판별에 실패하거나 5MB를 초과하는 파일이 하나라도 섞여 있으면 400 `invalid_image`를 반환하고, 해당 호출의 파일이 하나도 저장되지 않는다(부분 저장 없음).
3. 요청에 이미 저장된 사진 수 + 이번 호출 파일 수가 5장을 초과하면 409 `image_limit_exceeded`를 반환하고 새 행이 생기지 않는다.
4. 요청 작성자가 아닌 로그인 사용자 또는 비로그인 사용자가 `POST /api/requests/{id}/images`를 호출하면 각각 403 `not_request_owner`/401 `authentication_required`를 반환하고 사진이 저장되지 않는다.
5. 지원을 등록한 판매자 본인이 `POST /api/applications/{id}/images`를 호출하면 201과 이미지 목록(서명 URL)을 반환하고, 이후 `GET /api/applications/mine`(본인)과 `GET /api/requests/{id}/applications`(해당 요청 작성자)에서만 그 사진이 보인다.
6. 지원을 등록하지 않은 제3자(요청 작성자 포함)가 `POST /api/applications/{id}/images`를 호출하면 403 `not_application_owner`를 반환한다.
7. 요청 작성자가 아니고 그 지원의 판매자도 아닌 로그인 사용자가 해당 지원 사진의 서명 URL을 획득할 방법이 API 응답 어디에도 없다(다른 사용자로 로그인해 `GET /api/applications/mine`을 호출해도 남의 지원이 목록에 없음 — 기존 owner-scoped 쿼리로 자동 보장).
8. 정상적인 이미지 매직바이트를 가졌지만 픽셀 디코딩이 불가능한 손상 파일은 400 `invalid_image`로 거부된다.
9. GPS EXIF 태그가 포함된 사진을 업로드하면, Storage에 저장된 바이트에는 해당 EXIF 태그가 남아있지 않다(정제 파이프라인 단위 테스트로 확인).
10. 동시에 같은 요청에 사진 3장씩 업로드하는 두 요청을 동시에 보내면(합쳐서 5장 이하), 두 호출 모두 성공하고 `sort_order`가 서로 겹치지 않으며 `request_images`에 정확히 6장이 아니라 두 호출分(합계)만큼만 존재한다(경쟁 조건 테스트).
11. `request-images`/`application-images` 버킷과 `request_images`/`application_images` 테이블 모두 `anon`/`authenticated`에 어떤 쓰기 권한도 없다(`get_advisors` 또는 마이그레이션 리뷰로 확인) — 오직 서비스 롤(백엔드)만 쓸 수 있다.
12. `/requests/new`에서 사진 업로드가 실패해도(네트워크 오류 등 시뮬레이션) 텍스트로 생성된 요청은 유지되고, 사용자는 `/requests/{id}`로 정상 이동하며 실패 경고를 1회 확인한다.
13. `/requests/[id]` 상세 페이지는 사진이 있는 요청에서 사진 그리드를, 없는 요청에서는 그리드 섹션 자체를 렌더링하지 않는다(스냅샷/렌더 테스트).

## 11. 범위 밖 (후속 스펙 후보)

- 사진 개별 삭제·교체, 순서 재배치(드래그 정렬) UI 및 API.
- 요청/지원 자체의 수정(edit) 기능과 그에 따른 사진 추가/제거.
- 라이트박스/확대보기 모달, 이미지 캐러셀.
- Storage 업로드 성공·DB 트랜잭션 실패로 남는 고아 객체의 정리 배치.
- 서명 URL 만료(300초) 이후 프런트엔드에서의 자동 재발급/폴링(현재는 새로고침으로 복구).
- Supabase Storage 이미지 변환(리사이즈 온더플라이) 애드온 사용 — 지금은 백엔드가 업로드 시점에 1600px로 고정 축소한다.
