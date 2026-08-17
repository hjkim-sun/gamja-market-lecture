# 11. 판매자 다중 지원 및 구매자-판매자 1:1 채팅 설계

> 범위: 로그인한 사용자가 `모집중` 구매요청에 판매자로 지원하고(한 요청에 여러 판매자가 각자 한 번씩 지원), 요청 작성자(구매자)가 지원 중 하나를 수락하면 해당 판매자와의 1:1 채팅이 자동 개설되어 메시지를 주고받는 기능까지를 다룬다. 요청 상태의 완전한 수동 전이(`마감` 처리), 지원 취소/재지원, 채팅 실시간 푸시, 읽음 표시, 페이지네이션은 이번 범위 밖이며 후속 스펙에서 다룬다.

## 1. 현재 상태와 전환 결정

- `backend/app/api/requests.py`의 `GET /api/requests/{id}`는 이미 `isOwner`를 응답에 포함하고(`10-request-detail-owner-application-guard.md`), `frontend/src/app/requests/[id]/page.tsx`는 비소유자에게 항상 비활성 "이 요청에 지원하기" 버튼만 보여준다. 판매자 지원을 실제로 저장하는 테이블·API는 존재하지 않는다.
- `purchase_requests.status`는 이미 `모집중`/`협의중`/`마감` 세 값을 CHECK 제약으로 허용하지만(`08-purchase-request-registration-design.md`), 이 값을 바꾸는 API·서비스 로직은 아직 없다. 이번 스펙은 지원 수락 시 `협의중`로의 전이만 구현하고, `마감` 전이(거래 완료 처리)는 범위 밖으로 남긴다.
- 채팅·지원 관련 테이블은 전혀 없다(`backend/supabase/migrations`에 `purchase_requests`, `app_users`, `auth_sessions`만 존재).
- **역할(`buyer`/`seller`)은 계정 속성이 아니다.** `frontend/src/features/auth/components/RoleSelector.tsx`가 회원가입 화면에 역할 선택 UI를 두지만, `SignupRequest`(`backend/app/schemas/auth.py`)와 `app_users` 마이그레이션 어디에도 role 컬럼이 없다 — 즉 이 선택은 카피 문구용 UX일 뿐 서버에 저장되지 않는다. 따라서 이번 스펙도 계정 타입으로 권한을 가르지 않는다: **로그인한 모든 사용자가 다른 사람의 요청에는 판매자로 지원할 수 있고, 자신이 등록한 요청에는 지원할 수 없다.** 한 사람이 어떤 요청에는 구매자(작성자), 다른 요청에는 판매자(지원자)로 동시에 존재할 수 있다.
- **"다중 지원"의 정의**: 하나의 구매요청에 *서로 다른 여러 판매자*가 각자 한 건씩 지원할 수 있다는 뜻이다. 같은 판매자가 같은 요청에 두 번 이상 지원하는 것은 허용하지 않는다(`request_id`+`seller_id` 유니크 제약, 3절 참고). 재지원(거절된 지원을 다시 제출)은 범위 밖이다.
- 채팅은 사용자가 임의로 개설하지 않는다. **구매자가 지원 하나를 수락하는 순간 서버가 스레드를 자동 생성**하며, 그 스레드의 참여자는 항상 해당 요청의 작성자(`buyer_id`)와 수락된 지원의 판매자(`seller_id`) 두 명으로 고정된다. 스레드 생성 API는 별도로 두지 않는다.
- 실시간성: `purchase_requests`/`app_users`와 동일하게 신규 테이블도 RLS를 켜고 `anon`/`authenticated` 권한을 회수한다(브라우저의 Supabase 클라이언트는 이 테이블에 직접 접근할 수 없다). 즉 Supabase Realtime 구독을 쓸 수 없으므로, 채팅 메시지 갱신은 **클라이언트 폴링**(`GET /api/chats/{id}` 주기 재호출)으로 MVP를 구현한다. WebSocket/Realtime 전환은 후속 스펙에서 검토한다.

## 2. 데이터 모델

세 개의 신규 forward migration을 추가한다(기존 마이그레이션은 수정하지 않는다). 파일명은 `backend/supabase/migrations/<timestamp>_*.sql` 패턴을 따른다.

### 2.1 `request_applications` (`..._create_request_applications.sql`)

```sql
create table public.request_applications (
  id uuid primary key,
  request_id uuid not null references public.purchase_requests(id),
  seller_id uuid not null references public.app_users(id),
  offered_price integer not null,
  message text not null,
  status text not null default '대기중',
  created_at timestamptz not null default timezone('utc', now()),
  decided_at timestamptz,
  constraint request_applications_unique_seller_per_request unique (request_id, seller_id),
  constraint request_applications_offered_price_range check (offered_price > 0 and offered_price <= 100000000),
  constraint request_applications_message_length check (char_length(trim(message)) between 10 and 500),
  constraint request_applications_status_allowed check (status in ('대기중', '수락됨', '거절됨'))
);

create index request_applications_request_id_idx
  on public.request_applications (request_id, created_at desc);
create index request_applications_seller_id_idx
  on public.request_applications (seller_id, created_at desc);

alter table public.request_applications enable row level security;
revoke all on table public.request_applications from anon, authenticated;
```

- `offered_price` 범위는 `purchase_requests.desired_price`와 동일한 1~100,000,000 정수로 맞춘다(같은 "원" 단위 값이므로 일관성 유지).
- `message`는 구매요청 `description`(10~2000자)보다 짧은 10~500자로 제한한다 — 판매 제안 한 줄 메시지이지 상세 설명이 아니다.
- `seller_id = purchase_requests.requester_id`(자기 요청에 자기가 지원)를 막는 제약은 DB에 두지 않는다(다른 테이블 값을 참조하는 CHECK는 불가능하므로 트리거가 필요한데, 이번 스펙에서는 애플리케이션 계층 검증으로 충분하다고 판단한다). 서비스 계층에서 검증한다(4절).
- `(request_id, seller_id)` 유니크 제약이 "같은 판매자의 중복 지원"을 DB 레벨에서 최종 방어한다.
- `decided_at`은 수락/거절 시각을 기록해 향후 정렬·감사에 쓴다.

### 2.2 `chat_threads` (`..._create_chat_threads.sql`)

```sql
create table public.chat_threads (
  id uuid primary key,
  request_id uuid not null references public.purchase_requests(id),
  application_id uuid not null references public.request_applications(id),
  buyer_id uuid not null references public.app_users(id),
  seller_id uuid not null references public.app_users(id),
  created_at timestamptz not null default timezone('utc', now()),
  constraint chat_threads_unique_application unique (application_id),
  constraint chat_threads_buyer_seller_distinct check (buyer_id <> seller_id)
);

create index chat_threads_buyer_id_idx on public.chat_threads (buyer_id, created_at desc);
create index chat_threads_seller_id_idx on public.chat_threads (seller_id, created_at desc);

alter table public.chat_threads enable row level security;
revoke all on table public.chat_threads from anon, authenticated;
```

- `application_id`에 유니크 제약을 둬 지원 1건당 스레드가 최대 1개만 존재하도록 강제한다(수락 처리를 두 번 실행해도 스레드가 중복 생성되지 않는다).
- `request_id`를 중복 저장하는 이유는 채팅 목록/상세 화면에서 요청 제목을 표시할 때 `request_applications`를 거치지 않고 바로 조인하기 위함이다.

### 2.3 `chat_messages` (`..._create_chat_messages.sql`)

```sql
create table public.chat_messages (
  id uuid primary key,
  thread_id uuid not null references public.chat_threads(id),
  sender_id uuid not null references public.app_users(id),
  body text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint chat_messages_body_length check (char_length(trim(body)) between 1 and 2000)
);

create index chat_messages_thread_id_idx on public.chat_messages (thread_id, created_at asc);

alter table public.chat_messages enable row level security;
revoke all on table public.chat_messages from anon, authenticated;
```

- `sender_id`가 스레드의 `buyer_id`/`seller_id` 중 하나인지는 서비스 계층에서 검증한다(다른 테이블 참조라 CHECK로 표현 불가).

## 3. HTTP 계약

모든 요청/응답은 JSON, `Content-Type: application/json`. 기존 컨벤션과 동일하게 camelCase alias(`Field(alias=...)`)를 쓰고, 세션은 `gm_session` 쿠키로 식별한다.

### 3.1 판매자 지원 API

기존 `requests_router`(prefix `/requests`)에 하위 경로로 추가한다(`GET /api/requests/{id}`와 세그먼트 수가 달라 라우팅 충돌이 없다).

#### `POST /api/requests/{id}/applications` (로그인 필요)

요청:

```json
{ "offeredPrice": 700000, "message": "동일 모델 재고 있습니다. 오늘 바로 거래 가능해요." }
```

| 상태 | 응답 | 의미 |
| --- | --- | --- |
| 201 | `{ "id", "requestId", "offeredPrice", "message", "status": "대기중", "createdAt" }` | 지원 생성. `status`/`sellerId`는 클라이언트 입력을 무시한다. |
| 400 | `ApiError{code:"invalid_input"}` | `offeredPrice`/`message` 검증 실패 |
| 401 | `ApiError{code:"authentication_required"}` | 세션 없음/만료 |
| 403 | `ApiError{code:"cannot_apply_to_own_request"}` | 요청 작성자 본인이 자신의 요청에 지원 시도 |
| 404 | `ApiError{code:"not_found"}` | 요청이 없거나 id가 UUID가 아님 |
| 409 | `ApiError{code:"request_not_open"}` | 요청 상태가 `모집중`이 아님(이미 매칭/마감) |
| 409 | `ApiError{code:"already_applied"}` | 같은 판매자가 같은 요청에 이미 지원함 |

#### `GET /api/requests/{id}/applications` (요청 작성자 전용)

| 상태 | 응답 | 의미 |
| --- | --- | --- |
| 200 | `[{ "id", "sellerDisplayName", "offeredPrice", "message", "status", "createdAt" }, ...]` | `created_at desc` 정렬. 지원이 없으면 `[]`. |
| 401 | `ApiError{code:"authentication_required"}` | 세션 없음 |
| 403 | `ApiError{code:"not_request_owner"}` | 작성자가 아닌 로그인 사용자 |
| 404 | `ApiError{code:"not_found"}` | 요청 없음 |

`sellerDisplayName`은 `app_users.display_name`을 조인해서 채운다(작성자에게만 노출되는 화면이라 신원 노출이 안전하다). `sellerId`(UUID) 자체는 공개 응답에 넣지 않는다.

#### `GET /api/applications/mine` (로그인 필요, 신규 `applications_router`, prefix `/applications`)

| 상태 | 응답 | 의미 |
| --- | --- | --- |
| 200 | `[{ "id", "requestId", "requestTitle", "offeredPrice", "message", "status", "createdAt" }, ...]` | 내가 지원한 목록, `created_at desc` |
| 401 | `ApiError{code:"authentication_required"}` | 세션 없음 |

#### `PATCH /api/applications/{applicationId}` (요청 작성자 전용, 수락/거절)

요청:

```json
{ "decision": "accept" }
```

`decision`은 `"accept" | "reject"` 리터럴만 허용한다.

| 상태 | 응답 | 의미 |
| --- | --- | --- |
| 200 (accept) | `{ "application": {...status:"수락됨"}, "chatThreadId": "<uuid>" }` | 해당 지원 수락, 같은 요청의 다른 `대기중` 지원 전부 `거절됨`으로 자동 전환, `purchase_requests.status`가 `협의중`으로 전환, 채팅 스레드 1건 생성 |
| 200 (reject) | `{ "application": {...status:"거절됨"} }` | 해당 지원만 거절 |
| 400 | `ApiError{code:"invalid_input"}` | `decision` 값이 `accept`/`reject`가 아님 |
| 401 | `ApiError{code:"authentication_required"}` | 세션 없음 |
| 403 | `ApiError{code:"not_request_owner"}` | 해당 지원이 속한 요청의 작성자가 아님 |
| 404 | `ApiError{code:"not_found"}` | 지원 id 없음 |
| 409 | `ApiError{code:"application_already_decided"}` | 이미 `수락됨`/`거절됨` 상태인 지원에 재요청 |

수락 처리는 **하나의 DB 트랜잭션**으로 다음을 원자적으로 수행해야 한다: ① 대상 지원을 `수락됨`으로, ② 같은 `request_id`의 다른 `대기중` 지원을 전부 `거절됨`으로, ③ `purchase_requests.status`를 `협의중`으로, ④ `chat_threads` 1행 삽입. 기존 레포지토리들은 단일 테이블·단일 INSERT/SELECT만 다루므로, 이 트랜잭션은 `PostgresApplicationRepository.accept(...)` 안에 전용으로 구현하고(단일 `connect()` 블록에서 여러 SQL 문 실행), `SELECT ... FOR UPDATE`로 지원/요청 행을 잠가 동시 수락 요청 경합을 막는다.

### 3.2 채팅 API

신규 `chats_router`(prefix `/chats`).

#### `GET /api/chats` (로그인 필요)

| 상태 | 응답 | 의미 |
| --- | --- | --- |
| 200 | `[{ "id", "requestId", "requestTitle", "counterpartDisplayName", "viewerRole": "buyer"\|"seller", "lastMessageAt": string\|null }, ...]` | 내가 참여자인 스레드 목록. `lastMessageAt`(없으면 스레드 생성 시각) 내림차순. |
| 401 | `ApiError{code:"authentication_required"}` | 세션 없음 |

#### `GET /api/chats/{id}` (스레드 참여자 전용)

| 상태 | 응답 | 의미 |
| --- | --- | --- |
| 200 | `{ "id", "requestId", "requestTitle", "buyerDisplayName", "sellerDisplayName", "viewerId", "messages": [{ "id", "senderId", "body", "createdAt" }, ...] }` | 메시지는 `created_at asc` 전체 반환(페이지네이션은 범위 밖). `viewerId`로 프런트가 내 메시지/상대 메시지를 구분한다. |
| 401 | `ApiError{code:"authentication_required"}` | 세션 없음 |
| 403 | `ApiError{code:"not_chat_participant"}` | 스레드의 `buyer_id`/`seller_id`가 아닌 로그인 사용자 |
| 404 | `ApiError{code:"not_found"}` | 스레드 id 없음 |

#### `POST /api/chats/{id}/messages` (스레드 참여자 전용)

요청: `{ "body": "네, 오늘 오후 가능하신가요?" }`

| 상태 | 응답 | 의미 |
| --- | --- | --- |
| 201 | `{ "id", "senderId", "body", "createdAt" }` | 메시지 생성. `senderId`는 세션 사용자로 서버가 채운다. |
| 400 | `ApiError{code:"invalid_input"}` | `body` trim 후 1~2000자 범위 밖 |
| 401 | `ApiError{code:"authentication_required"}` | 세션 없음 |
| 403 | `ApiError{code:"not_chat_participant"}` | 참여자가 아님 |
| 404 | `ApiError{code:"not_found"}` | 스레드 id 없음 |

## 4. 인증·검증·보안

- 모든 신규 엔드포인트는 기존 패턴대로 `gm_session` 쿠키를 `AuthService.me()`로 검증한다. `InvalidSessionError` → 401 `authentication_required`.
- **지원 생성 권한**: `seller_id`(세션 사용자) `== request.requester_id`이면 403 `cannot_apply_to_own_request`. 이 비교는 서비스 계층에서 요청을 먼저 조회해 수행한다(요청이 없으면 404가 우선).
- **지원 생성 상태 가드**: `request.status != '모집중'`이면 409 `request_not_open`. 클라이언트가 이 값을 우회해 직접 호출해도 서버가 최종적으로 막는다.
- **중복 지원**: `PostgresApplicationRepository.create`가 유니크 제약 위반(`sqlstate 23505`, `request_applications_unique_seller_per_request`)을 잡아 `AlreadyAppliedError`로 변환 → 409 `already_applied` (기존 `EmailAlreadyExistsError` 패턴과 동일한 방식).
- **지원자 목록/수락/거절 권한**: 요청의 `requester_id`(수락/거절은 지원이 속한 요청의 `requester_id`)와 세션 사용자가 일치해야 한다. 불일치 시 403 `not_request_owner`. `isOwner` 판단 로직(`backend/app/api/requests.py`의 기존 비교)과 동일한 방식을 재사용한다.
- **지원 상태 전이 가드**: 수락/거절 대상 지원의 `status`가 `대기중`이 아니면 409 `application_already_decided`(멱등하지 않은 재요청 방지).
- **수락 트랜잭션의 원자성**: 3.1절에서 설명한 대로 단일 트랜잭션 + 행 잠금으로 처리한다. 동시에 두 지원을 각각 수락하려는 경쟁 조건에서, 먼저 커밋된 트랜잭션만 성공하고 두 번째는 `request.status`가 이미 `협의중`으로 바뀐 것을 잠금 후 재확인해 409 `request_not_open`으로 실패시킨다.
- **채팅 참여자 검증**: `thread.buyer_id`/`thread.seller_id` 중 하나와 세션 사용자 id가 일치해야 조회/전송 가능. 불일치 시 403 `not_chat_participant`(스레드 존재 자체를 숨기지는 않되, 내용은 노출하지 않는다).
- **본문 검증**: 신규 Pydantic 모델(`CreateApplicationInput`, `DecideApplicationInput`, `SendMessageInput`)이 `CreateRequestInput`과 동일한 스타일로 `field_validator`를 사용해 trim 후 길이/범위를 검증한다. 서버 검증이 최종 권위이며 DB CHECK 제약이 최후 방어선이라는 기존 원칙을 유지한다.
- 신규 테이블 3종 모두 RLS를 켜고 `anon`/`authenticated`에 권한을 부여하지 않는다 — FastAPI 전용 DB 자격증명만 접근한다(`app_users`/`purchase_requests`와 동일한 격리).
- `DATABASE_URL` 미설정 시를 위해 `InMemoryApplicationRepository`/`InMemoryChatRepository`를 두어 계약 테스트·로컬 개발이 가능하게 한다(기존 `InMemoryPurchaseRequestRepository` 패턴).

## 5. 프런트엔드 동작 (화면 흐름)

### 5.1 `/requests/[id]` 상세 페이지 상태 분기 (`frontend/src/app/requests/[id]/page.tsx` 수정)

`GET /api/requests/{id}`가 이미 반환하는 `isOwner`에 더해, 같은 응답(또는 조합 호출)에 뷰어의 지원 상태를 함께 판단할 근거가 필요하다 — 상세 페이지 서버 컴포넌트가 `getRequestById`와 함께 로그인 시에만 `GET /api/applications/mine`을 호출해 현재 요청에 대한 내 지원을 찾거나, 더 단순하게 `PurchaseRequestDetailOut`에 `viewerApplicationStatus: "대기중"|"수락됨"|"거절됨"|null` 필드를 추가해 한 번의 호출로 해결한다(후자를 채택 — 기존 `isOwner` 확장과 동일한 패턴이라 별도 호출 왕복을 늘리지 않는다).

버튼/문구 분기:

| 뷰어 상태 | 요청 상태 | 표시 |
| --- | --- | --- |
| 비로그인 | 무관 | 기존과 동일한 비활성 안내 버튼 유지(로그인 유도) |
| 작성자(`isOwner`) | `모집중`, 지원 0건 | "내가 등록한 요청이에요" (기존 유지) |
| 작성자 | `모집중`, 지원 ≥1건 | 위 문구 + "지원자 보기 (N)" → `/requests/[id]/applications` 링크 |
| 작성자 | `협의중`/`마감` | "매칭된 판매자와 대화 중이에요" + "채팅으로 이동" → `/chats/{threadId}` |
| 비작성자, 지원 없음, `모집중` | `모집중` | 활성화된 "이 요청에 지원하기" → `/requests/[id]/apply` |
| 비작성자, `viewerApplicationStatus === "대기중"` | 무관 | 비활성 "지원 완료 · 답변 대기중" |
| 비작성자, `viewerApplicationStatus === "거절됨"` | 무관 | 비활성 "이 지원은 거절되었어요" |
| 비작성자, `viewerApplicationStatus === "수락됨"` | 무관 | "채팅으로 이동" → `/chats/{threadId}` |
| 비작성자, 지원 없음 | `협의중`/`마감` | 비활성 "이미 매칭이 완료된 요청이에요" |

### 5.2 지원 폼: `/requests/[id]/apply` (신규)

`/requests/new`와 동일한 서버 컴포넌트 인증 게이트 패턴(`GET /api/auth/me` 확인 → 비로그인이면 `/login?next=/requests/[id]/apply`로 redirect). `offeredPrice`(number), `message`(textarea) 2개 필드만 받는다. 제출은 `frontend/src/features/applications/actions/applications.ts`의 `applyToRequest` 서버 액션이 `POST /api/requests/{id}/applications`를 호출한다.

- 201 → `/requests/{id}`로 이동(성공 안내).
- 400 → 필드별 오류 표시(`frontend/src/features/applications/lib/application-input.ts`가 클라이언트 측 동일 규칙으로 선검증).
- 401 → `/login?next=/requests/[id]/apply`.
- 403(`cannot_apply_to_own_request`)/409(`request_not_open`/`already_applied`) → 폼 대신 안내 메시지와 `/requests/{id}`로 돌아가는 링크.

### 5.3 지원자 목록: `/requests/[id]/applications` (신규, 작성자 전용)

서버 컴포넌트가 `GET /api/requests/{id}/applications`를 세션 쿠키와 함께 호출한다. 403/401이면 `/requests/{id}`로 redirect(작성자가 아닌 사용자에게 목록을 노출하지 않는다 — `10-request-detail-owner-application-guard.md`와 동일한 가드 정신). 각 지원 카드에 판매자 표시이름·제안가·메시지·등록 시각과, `대기중`일 때만 "수락"/"거절" 버튼을 보여준다. 버튼은 `frontend/src/features/applications/actions/applications.ts`의 `decideApplication` 서버 액션(`PATCH /api/applications/{id}`)을 호출한다.

- 수락 성공 → 응답의 `chatThreadId`로 `/chats/{chatThreadId}`로 이동.
- 거절 성공 → 같은 페이지에서 해당 카드 상태만 `거절됨`으로 갱신.
- 409(`application_already_decided`) → "다른 브라우저에서 이미 처리됐어요" 안내 후 목록 새로고침.

### 5.4 채팅 목록: `/chats` (신규)

로그인 필요(비로그인 시 `/login?next=/chats`). `GET /api/chats` 결과를 상대방 표시이름 + 요청 제목 + 마지막 활동 시각 카드 목록으로 렌더링. 비어 있으면 "아직 진행 중인 채팅이 없어요" 안내.

### 5.5 채팅 스레드: `/chats/[id]` (신규)

로그인 필요, 참여자가 아니면(403/404) `/chats`로 redirect. `GET /api/chats/{id}`로 초기 메시지를 서버에서 렌더링하고, 클라이언트 컴포넌트가 일정 주기(예: 4초)로 같은 엔드포인트를 폴링해 새 메시지를 반영한다(5.6절에서 다루는 `ChatThread.tsx`). 메시지 전송 폼은 `frontend/src/features/chats/actions/chats.ts`의 `sendChatMessage` 서버 액션이 `POST /api/chats/{id}/messages`를 호출한다. `senderId === viewerId`면 오른쪽 정렬(내 메시지), 아니면 왼쪽 정렬(상대 메시지)로 렌더링한다.

### 5.6 내비게이션

`frontend/src/components/layout/Header.tsx`의 `primaryLinks`는 로그인 여부와 무관한 공개 링크만 담고 있으므로 그대로 두고, 이미 있는 `signedIn` 분기(계정 메뉴 근처)에 로그인 시에만 보이는 "채팅" 링크(`/chats`)를 추가한다(데스크톱 nav와 모바일 drawer 양쪽).

## 6. 정확한 변경 대상

| 구분 | 파일 | 작업 |
| --- | --- | --- |
| DB | `backend/supabase/migrations/<ts>_create_request_applications.sql` | `request_applications` 테이블·제약·인덱스·RLS |
| DB | `backend/supabase/migrations/<ts>_create_chat_threads.sql` | `chat_threads` 테이블·제약·인덱스·RLS |
| DB | `backend/supabase/migrations/<ts>_create_chat_messages.sql` | `chat_messages` 테이블·제약·인덱스·RLS |
| Backend 신규 | `backend/app/schemas/applications.py` | `CreateApplicationInput`, `DecideApplicationInput`, `ApplicationOut`, `OwnerApplicationOut`, `MyApplicationOut` |
| Backend 신규 | `backend/app/repositories/applications.py` | `ApplicationRepository` Protocol + `InMemory`/`Postgres` 구현(`create`/`list_by_request`/`list_by_seller`/`get_by_id`/`accept`(트랜잭션)/`reject`) |
| Backend 신규 | `backend/app/services/applications.py` | 지원 생성/조회/수락/거절 유스케이스, 소유권·상태 가드 |
| Backend 신규 | `backend/app/api/applications.py` | `applications_router`: `GET /applications/mine`, `PATCH /applications/{id}` |
| Backend 수정 | `backend/app/api/requests.py` | `POST/GET /requests/{id}/applications` 라우트 추가 |
| Backend 수정 | `backend/app/schemas/requests.py` | `PurchaseRequestDetailOut`에 `viewerApplicationStatus` 추가 |
| Backend 신규 | `backend/app/schemas/chats.py` | `SendMessageInput`, `ChatThreadSummaryOut`, `ChatThreadDetailOut`, `ChatMessageOut` |
| Backend 신규 | `backend/app/repositories/chats.py` | `ChatRepository` Protocol + `InMemory`/`Postgres` 구현 |
| Backend 신규 | `backend/app/services/chats.py` | 목록/상세/메시지 전송 유스케이스, 참여자 가드 |
| Backend 신규 | `backend/app/api/chats.py` | `chats_router`: `GET /chats`, `GET /chats/{id}`, `POST /chats/{id}/messages` |
| Backend 수정 | `backend/app/api/router.py` | `applications_router`, `chats_router` 등록 |
| Frontend 수정 | `frontend/next.config.ts` | `/api/applications/:path*`, `/api/chats/:path*` rewrite 추가 |
| Frontend 신규 | `frontend/src/types/application.ts`, `frontend/src/types/chat.ts` | 응답 타입 정의 |
| Frontend 신규 | `frontend/src/features/applications/lib/application-input.ts` | 폼 파싱·클라이언트 검증 |
| Frontend 신규 | `frontend/src/features/applications/data/applications-api.ts` | `getApplicationsForRequest`, `getMyApplications` same-origin fetch |
| Frontend 신규 | `frontend/src/features/applications/actions/applications.ts` | `applyToRequest`, `decideApplication` 서버 액션 |
| Frontend 신규 | `frontend/src/features/applications/components/ApplyForm.tsx`, `ApplicationList.tsx` | 지원 폼 / 지원자 목록 UI |
| Frontend 신규 | `frontend/src/app/requests/[id]/apply/page.tsx` | 인증 게이트 + `ApplyForm` |
| Frontend 신규 | `frontend/src/app/requests/[id]/applications/page.tsx` | 작성자 가드 + `ApplicationList` |
| Frontend 수정 | `frontend/src/app/requests/[id]/page.tsx` | 5.1절 상태 분기 반영 |
| Frontend 신규 | `frontend/src/features/chats/data/chats-api.ts` | `getMyChatThreads`, `getChatThreadById` |
| Frontend 신규 | `frontend/src/features/chats/actions/chats.ts` | `sendChatMessage` 서버 액션 |
| Frontend 신규 | `frontend/src/features/chats/components/ChatThreadList.tsx`, `ChatThread.tsx` | 채팅 목록 / 폴링 메시지 뷰 |
| Frontend 신규 | `frontend/src/app/chats/page.tsx`, `frontend/src/app/chats/[id]/page.tsx` | 채팅 목록·상세 페이지 |
| Frontend 수정 | `frontend/src/components/layout/Header.tsx` | 로그인 시 "채팅" nav 링크 추가 |
| 테스트(별도 RED 작업) | `backend/tests/test_applications.py`, `backend/tests/test_chats.py` | 8절 수용 기준에 1:1 대응하는 계약 테스트 |
| 테스트(별도 RED 작업) | `frontend/tests/features/applications/*`, `frontend/tests/features/chats/*`, `frontend/tests/app/request-apply-page.test.tsx`, `frontend/tests/app/request-applications-page.test.tsx`, `frontend/tests/app/chats-page.test.tsx`, `frontend/tests/app/chat-thread-page.test.tsx`, `frontend/tests/app/request-detail-page.test.tsx`(상태 분기 확장) | UI/서버 액션 테스트 |

## 7. 구현 순서

1. 세 마이그레이션을 추가하고 `get_advisors`(또는 마이그레이션 리뷰)로 RLS/권한 격리를 확인한다.
2. `request_applications` 계약(schemas/repositories/services/api)을 구현한다 — 생성·목록·수락·거절, 특히 수락 트랜잭션의 원자성을 backend 테스트로 먼저 고정한다(RED → GREEN).
3. `PurchaseRequestDetailOut.viewerApplicationStatus`를 추가하고 기존 `request-detail-page` 테스트가 깨지지 않는지 확인한다.
4. `chat_threads`/`chat_messages` 계약을 구현한다 — 목록·상세·메시지 전송, 참여자 가드.
5. 프런트엔드 지원 폼·지원자 목록·상세 페이지 상태 분기를 구현한다.
6. 프런트엔드 채팅 목록·스레드(폴링 포함) 페이지와 Header 링크를 구현한다.
7. 8절의 수용 기준을 자동 테스트로 확인한다.

## 8. 수용 기준

1. 로그인한 비작성자가 `모집중` 요청에 유효한 `offeredPrice`(1~100,000,000)·`message`(10~500자)로 지원하면 201과 `status:"대기중"`을 반환하고, `GET /api/requests/{id}/applications`(작성자 조회)에 나타난다.
2. 같은 판매자가 같은 요청에 두 번째로 지원하면 409 `already_applied`를 반환하고 새 행이 생기지 않는다.
3. 요청 작성자 본인이 자신의 요청에 지원을 시도하면 403 `cannot_apply_to_own_request`를 반환하고 행이 생기지 않는다.
4. 비로그인 사용자의 지원 시도는 401 `authentication_required`를 반환한다.
5. `offeredPrice`가 범위 밖이거나 `message`가 10자 미만/500자 초과이면 400 `invalid_input`을 반환하고 행이 생기지 않는다(클라이언트 우회 직접 호출 포함).
6. 요청 작성자가 아닌 로그인 사용자 또는 비로그인 사용자가 `GET /api/requests/{id}/applications`를 호출하면 403/401을 반환하고 지원 목록이 노출되지 않는다.
7. 작성자가 지원 하나를 `accept`하면: 해당 지원이 `수락됨`, 같은 요청의 다른 `대기중` 지원이 전부 `거절됨`, `purchase_requests.status`가 `협의중`으로 바뀌고, 응답에 새로 생성된 `chatThreadId`가 포함된다.
8. 이미 `수락됨`/`거절됨` 상태인 지원에 다시 `accept`/`reject`를 호출하면 409 `application_already_decided`를 반환하고 상태가 변하지 않는다.
9. 지원이 속한 요청의 작성자가 아닌 로그인 사용자가 `accept`/`reject`를 호출하면 403 `not_request_owner`를 반환한다.
10. 매칭된 `buyer_id`/`seller_id` 두 사람만 해당 채팅 스레드를 `GET`/`POST`할 수 있고, 제3의 로그인 사용자는 403 `not_chat_participant`를 받는다.
11. 채팅 메시지는 trim 후 1~2000자를 벗어나면 400 `invalid_input`으로 거부되며 저장되지 않는다.
12. `/requests/[id]` 페이지는 5.1절 표의 9가지 뷰어×상태 조합 각각에 대해 지정된 버튼/문구를 렌더링한다(UI 테스트).
13. 비로그인 사용자가 `/requests/[id]/apply`, `/requests/[id]/applications`, `/chats`, `/chats/[id]`에 접근하면 각각 `next` 파라미터가 보존된 `/login`으로 redirect되고, 로그인 후 원래 경로로 복귀한다.
14. `request_applications`, `chat_threads`, `chat_messages` 마이그레이션은 모두 RLS가 켜져 있고 `anon`/`authenticated`에 권한을 부여하지 않는다(`app_users`/`purchase_requests`와 동일한 격리를 migration 리뷰 또는 `get_advisors`로 확인).
15. 동시에 두 지원을 각각 수락하려는 경쟁 조건에서 하나만 성공하고 나머지는 409 `request_not_open`으로 실패하며, `chat_threads`에는 정확히 1행만 생성된다(트랜잭션/잠금 테스트).
