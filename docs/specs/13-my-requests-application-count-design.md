# 13. 내 구매요청 목록 지원자 수 표시 설계

> 범위: 로그인한 구매요청 작성자가 `/requests/mine`에서 자신이 등록한 구매요청 목록을 보고, 각 요청 카드에 "현재 지원자 수: N명"을 표시한다. `GET /api/requests/mine` 백엔드 엔드포인트와 `/requests/mine` 프런트엔드 페이지 자체가 아직 존재하지 않으므로(1절), 이번 스펙은 `12-my-account-menu-design.md` §5에서 이미 예정된 이 목적지 페이지의 최소 골격을 지원자 수 필드를 포함해 처음부터 구현하는 것으로 범위를 잡는다. 지원자 상세(판매자 신원·제안가·메시지) 열람은 기존 `/requests/[id]/applications`(스펙 11)로의 링크로만 연결하고, 이 페이지 자체에서 지원자 개별 정보를 노출하지 않는다. 페이지네이션, 필터/정렬 옵션, 지원자 수의 실시간 갱신(폴링/푸시)은 범위 밖이다.

## 1. 현재 상태와 전환 결정

- **`/requests/mine`은 아직 존재하지 않는다.** `12-my-account-menu-design.md` 상단의 "구현 상태" 메모가 명시하듯, 그 스펙은 헤더의 "내 계정" 드롭다운·모바일 drawer에 `/requests/mine` 링크만 추가했고(`frontend/src/components/layout/Header.tsx:125,167`), 목적지 페이지(`frontend/src/app/requests/mine/page.tsx`)와 이를 뒷받침하는 `GET /api/requests/mine`(`backend/app/api/requests.py`)는 후속 작업으로 명시적으로 미뤄졌다. 실제로 `frontend/src/app/requests/` 아래에 `mine/` 디렉터리가 없고, `backend/app/api/requests.py`에도 `/mine` 라우트가 없다 — 지금 그 링크를 누르면 404다. 이 스펙이 그 후속 작업이다.
- **지원 데이터 모델은 이미 완성돼 있다.** `request_applications` 테이블·리포지토리·서비스(`11-seller-applications-and-buyer-seller-chat-design.md`)가 존재하며, `backend/app/repositories/applications.py`의 `list_by_request(request_id)`가 한 요청에 달린 모든 지원(모든 상태 포함)을 반환한다. 이번 스펙은 새 테이블을 만들지 않고 이 테이블을 집계만 한다.
- **`applicationCount`라는 이름은 이미 프런트엔드에 존재하지만 백엔드가 채운 적이 없다.** `frontend/src/types/request.ts`의 `PurchaseRequest.applicationCount?: number`와 `frontend/src/app/requests/[id]/page.tsx`의 "지원자 보기 (N)" 문구(`11`절 5.1의 상세 페이지 상태 분기)가 이 필드를 참조하지만, `backend/app/schemas/requests.py`의 `PurchaseRequestDetailOut`에는 대응 필드가 없다 — 즉 상세 페이지에서는 지금 이 필드가 항상 `undefined`이고, 코드가 이를 방어적으로 처리해 숫자 없는 "지원자 보기" 링크만 보여준다. **이 상세 페이지 쪽 공백은 이번 스펙의 범위가 아니다** — 작업 지시가 `/requests/mine`으로 한정돼 있고, 상세 페이지의 카운트 노출은 별도 스펙에서 다뤄야 한다(예: `viewerApplicationStatus`처럼 `PurchaseRequestDetailOut` 확장이 필요). 다만 이름 충돌을 피하기 위해, 이번 스펙에서 신설하는 `/requests/mine` 응답 필드도 동일하게 `applicationCount`라는 이름을 쓰고 의미를 통일한다(5절).
- **"지원자 수"의 의미를 명시적으로 정의한다**: 상태(`대기중`/`수락됨`/`거절됨`) 구분 없이 해당 요청에 접수된 지원 총 건수다. 이유: `/requests/[id]/applications`(작성자 전용 지원자 목록, 스펙 11 §3.1) 역시 상태 무관 전체 지원을 나열하므로, `/requests/mine` 카드의 숫자가 그 목록 페이지로 이동했을 때 보이는 행 수와 정확히 일치해야 혼란이 없다. "현재"라는 단어는 "지금 이 순간 누적된 지원 건수"라는 뜻이며 "현재 응답 대기 중인 지원만"이라는 뜻이 아니다.
- 두 목적지 모두(스펙 12에서 이미 결정) 로그인이 전제이므로, `08`/`11`이 쓰는 서버 컴포넌트 인증 게이트 패턴을 그대로 따른다. 다만 게이트 구현 방식은 두 가지가 혼재한다: `frontend/src/app/requests/new/page.tsx`는 `GET /api/auth/me`를 별도 호출해 인증 여부만 확인하는 방식이고, `frontend/src/app/chats/page.tsx`는 목록 조회 함수 자체가 `{ ok: false, status }`를 반환해 그 결과로 리다이렉트하는 방식이다(왕복 요청이 하나 적다). 이번 스펙은 후자를 채택한다 — `getMyApplications()`(현재 실패 시 `[]`만 반환)를 제외한 최근 신규 목록 fetch 함수(`getApplicationsForRequest`, `getMyChatThreads`)가 모두 이 방식이므로 신규 코드는 이 관행을 따른다.

## 2. 데이터 모델

신규 테이블 없음. 기존 `request_applications`(스펙 11 §2.1)를 집계 쿼리로 소비한다.

## 3. API 계약

### `GET /api/requests/mine` (로그인 필요)

기존 `requests_router`(prefix `/requests`)에 추가한다.

| 상태 | 응답 | 의미 |
| --- | --- | --- |
| 200 | `[{ "id", "title", "category", "desiredPrice", "status", "description", "createdAt", "applicationCount" }, ...]` | 세션 사용자가 `requester_id`인 구매요청만, `created_at desc` 정렬. 요청이 없으면 `[]`. |
| 401 | `ApiError{code:"authentication_required"}` | 세션 없음/만료 |

응답 스키마는 기존 `PurchaseRequestOut`(공개 목록/생성 응답과 동일한 필드 6개)에 `applicationCount`(정수, 항상 포함, 지원이 없으면 `0`)만 얹는다 — `PurchaseRequestOut` 자체는 건드리지 않고 `PurchaseRequestDetailOut`과 같은 방식으로 서브클래스를 새로 둔다:

```python
# backend/app/schemas/requests.py
class MyPurchaseRequestOut(PurchaseRequestOut):
    """GET /requests/mine 전용 — 요청자 본인 소유 요청에 한해 지원 건수를 항상 포함한다."""

    application_count: int = Field(alias="applicationCount")
```

`requester_id`는 기존 `PurchaseRequestOut`과 동일하게 응답에 포함하지 않는다(이미 세션으로 소유권이 증명됐으므로 클라이언트가 다시 알 필요가 없다).

**라우트 등록 순서에 주의**: `requests_router`는 이미 `GET /requests/{request_id}`를 갖고 있고, 그 핸들러는 `request_id`를 `UUID(...)`로 파싱해 실패하면 404를 반환한다(`backend/app/api/requests.py:81-84`). `/requests/mine`은 세그먼트 수가 같은 리터럴 경로이므로, `GET /requests/{request_id}`보다 **나중에** 등록하면 `"mine"`이 그 동적 라우트로 먼저 매칭되어 UUID 파싱 실패로 404를 반환해버린다(FastAPI/Starlette는 선언 순서대로 라우트를 매칭한다). 따라서 `GET /requests/mine` 데코레이터는 반드시 `GET /requests/{request_id}` 정의보다 **위에** 와야 한다.

## 4. 인증·권한

- 다른 신규 엔드포인트와 동일하게 `gm_session` 쿠키를 `AuthService.me()`로 검증한다. 세션이 없거나 무효하면 `InvalidSessionError` → 401 `authentication_required`.
- 별도의 소유권 검사 로직이 필요 없다 — 쿼리 자체가 세션 사용자의 `requester_id`로 한정되므로, 다른 사용자의 구매요청이나 지원 건수가 이 응답에 섞일 수 있는 경로가 없다(요청 id를 파라미터로 받지 않는 엔드포인트이므로 IDOR 여지가 없다).
- 지원자 수는 요청 소유자에게만 노출된다는 원칙은 유지되지만, 이는 `/requests/mine`이 애초에 로그인 사용자 본인 소유 레코드만 반환하기 때문이지, 카운트 필드 자체에 별도 마스킹 로직이 있는 게 아니다.

## 5. 정렬·0건 처리

- **목록 정렬**: `created_at desc` (기존 `GET /requests`, `GET /applications/mine`과 동일 컨벤션).
- **요청이 0건**(아직 아무것도 등록하지 않은 사용자): `GET /api/requests/mine`은 200과 `[]`를 반환한다(에러 아님). 프런트엔드는 "아직 등록한 구매요청이 없어요" 안내와 `/requests/new` 링크를 보여준다(스펙 12 §3과 동일 문구/패턴).
- **지원자가 0명인 개별 요청**: 해당 항목의 `applicationCount`는 `0`이다(`null`이나 필드 생략이 아니다 — 프런트엔드가 "몇 명인지 모름"과 "0명"을 구분하지 않아도 되게 항상 정수를 보낸다). 카드에는 "현재 지원자 수: 0명"을 일반 텍스트로 표시하고, 지원자가 없는 지원자 목록 페이지로 이동시키는 링크는 만들지 않는다(상세 페이지의 "지원자 보기" 링크가 0건일 때 숨겨지는 것과 동일한 결정 — 스펙 11 §5.1).
- **지원자가 1명 이상인 요청**: "현재 지원자 수: N명"을 `/requests/[id]/applications`로 이동하는 링크로 렌더링한다.

| `applicationCount` | 렌더링 |
| --- | --- |
| `0` | `현재 지원자 수: 0명` (일반 텍스트, 링크 아님) |
| `N` (`N ≥ 1`) | `현재 지원자 수: N명` (`/requests/{id}/applications`로 이동하는 링크) |

## 6. 백엔드 구현 세부

### 6.1 카운트 집계 (`backend/app/repositories/applications.py`)

`ApplicationRepository` Protocol에 배치 카운트 메서드를 추가한다 — 목록 페이지가 요청 N건을 가질 수 있으므로 요청마다 개별 쿼리(N+1)를 날리지 않고 한 번에 집계한다.

```python
def count_by_request_ids(self, request_ids: list[UUID]) -> dict[UUID, int]: ...
```

- `InMemoryApplicationRepository`: `self._applications.values()`를 순회해 `request_id`별로 세되, 인자로 받은 `request_ids`에 속하지 않는 것은 무시한다. 빈 입력이면 빈 dict를 반환한다.
- `PostgresApplicationRepository`: `request_ids`가 비어 있으면 쿼리 없이 `{}`를 반환한다(빈 배열로 `= any()`를 날리는 왕복을 아낀다). 아니면:
  ```sql
  select request_id, count(*) from public.request_applications
  where request_id = any(%s) group by request_id
  ```
  결과에 없는 `request_id`는 지원이 0건이라는 뜻이므로, 서비스 계층에서 `counts.get(request_id, 0)`으로 기본값 0을 채운다(모든 상태를 포함하므로 `status` 필터는 걸지 않는다 — 1절 정의 참고).

### 6.2 소유 요청 조회 (`backend/app/repositories/requests.py`)

`PurchaseRequestRepository` Protocol에 추가(스펙 12 §5가 이미 예정한 메서드):

```python
def list_by_requester(self, requester_id: UUID) -> list[PurchaseRequest]: ...
```

`InMemoryPurchaseRequestRepository`/`PostgresPurchaseRequestRepository` 양쪽에 `list()`와 동일한 정렬(`created_at desc`)로 `requester_id = %s` 필터만 추가한 버전을 구현한다.

### 6.3 유스케이스 (`backend/app/services/requests.py`)

`PurchaseRequestService`는 현재 `(requests: PurchaseRequestRepository, auth: AuthService)`만 받는다. 지원 건수 집계를 위해 `ApplicationRepository`를 세 번째 의존성으로 주입한다(생성자 시그니처 변경). 이 방식은 `ApplicationService`가 이미 `PurchaseRequestRepository`를 직접 주입받아 쓰는 것과 동일한 교차-도메인 리포지토리 의존 패턴이라 이 코드베이스의 기존 관례를 벗어나지 않는다.

```python
def list_mine(self, session_token: str | None) -> list[tuple[PurchaseRequest, int]]:
    user = self._auth.me(session_token)  # 세션 없음/무효 → InvalidSessionError
    requests = self._requests.list_by_requester(user.id)
    counts = self._applications.count_by_request_ids([r.id for r in requests])
    return [(r, counts.get(r.id, 0)) for r in requests]
```

`backend/app/api/dependencies.py`의 `requests_service = PurchaseRequestService(request_repository, _auth_service)` 호출에 `application_repository`를 세 번째 인자로 추가해야 한다(순환 임포트 없음: `app.repositories.applications`는 `app.services.requests`를 참조하지 않으므로 `services/requests.py`가 `repositories/applications.py`의 `ApplicationRepository`를 임포트해도 순환이 생기지 않는다).

### 6.4 라우트 (`backend/app/api/requests.py`)

`GET /requests/{request_id}` 정의보다 위에 추가(3절의 라우트 순서 주의사항):

```python
@requests_router.get("/mine", response_model=list[MyPurchaseRequestOut], responses={status.HTTP_401_UNAUTHORIZED: {"model": ApiError}})
def list_my_purchase_requests(gm_session: str | None = Cookie(default=None)) -> list[MyPurchaseRequestOut] | JSONResponse:
    try:
        rows = _requests_service.list_mine(gm_session)
    except InvalidSessionError:
        return _authentication_required_response()
    return [
        MyPurchaseRequestOut(**PurchaseRequestOut.model_validate(r, from_attributes=True).model_dump(), application_count=count)
        for r, count in rows
    ]
```

(`_authentication_required_response`는 이미 이 파일에 정의돼 있는 헬퍼를 재사용한다.)

## 7. 프런트엔드 동작

### 7.1 타입 (`frontend/src/types/request.ts`)

`PurchaseRequest`(상세/공개 목록용, 뷰어별 선택 필드가 섞여 있음)를 확장하지 않고 별도 타입을 신설한다 — `/requests/mine` 항목은 항상 자기 소유 요청이라 `isOwner`/`viewerApplicationStatus`/`viewerChatThreadId` 같은 뷰어-상대 필드가 의미가 없고, `applicationCount`는 반대로 이 응답에서는 항상 존재해 선택적(`?`)이 아니어야 하기 때문이다.

```ts
/** One row of `GET /api/requests/mine` — the requester's own purchase requests. */
export type MyPurchaseRequest = {
  id: string;
  title: string;
  desiredPrice: number;
  status: "모집중" | "협의중" | "마감";
  category: RequestCategory;
  createdAt: string;
  description: string;
  /** Total applications received so far across all statuses. Always present; 0 means none yet. */
  applicationCount: number;
};
```

### 7.2 fetch 함수 (`frontend/src/features/requests/data/requests-api.ts`)

`getApplicationsForRequest`/`getMyChatThreads`와 동일한 `{ ok, status }` 결과 패턴을 쓴다(1절에서 결정):

```ts
export type MyRequestsResult =
  | { ok: true; requests: MyPurchaseRequest[] }
  | { ok: false; status: number };

export async function getMyRequests(): Promise<MyRequestsResult> {
  const { cookie, url } = await getSameOriginRequest("/api/requests/mine");
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", headers: cookie ? { Cookie: cookie } : undefined });
  } catch {
    return { ok: false, status: 0 };
  }
  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true, requests: (await response.json()) as MyPurchaseRequest[] };
}
```

`getSameOriginRequest`는 이미 `/api/requests${string}` 패턴을 허용하므로(`frontend/src/lib/api/same-origin-request.ts`) 이 파일은 수정할 필요가 없다.

### 7.3 페이지 (`frontend/src/app/requests/mine/page.tsx`, 신규)

`/chats/page.tsx`와 동일한 게이트 패턴: `getMyRequests()` 결과가 `{ ok: false }`이면 `redirect("/login?next=/requests/mine")`. 성공하면 카드 그리드를 렌더링한다(`/requests` 목록 페이지의 카드 레이아웃·`StatusBadge` 재사용, 신규 CSS 불필요). 각 카드는:

- 기존 `/requests` 카드와 동일한 정보(카테고리, 상태 배지, 제목, 희망가, 등록일) — `/requests/{id}`로 이동하는 링크.
- 그 아래 5절 표에 정의된 지원자 수 줄 — `applicationCount`가 0이면 일반 텍스트, 1 이상이면 `/requests/{id}/applications`로 이동하는 별도 링크. 카드 전체를 감싸는 하나의 `<Link>`로 만들지 않는다(내부에 목적지가 다른 링크 두 개가 공존해야 하므로, `/requests` 페이지처럼 카드 전체를 앵커로 감싸는 방식은 여기서 쓸 수 없다 — 제목/가격 블록과 지원자 수 링크를 별개의 `<Link>`로 둔다).
- 빈 목록: "아직 등록한 구매요청이 없어요" 안내 + `/requests/new` 링크(스펙 12 §3, `/requests` 빈 상태 문구 톤 재사용).

## 8. 정확한 변경 대상

| 구분 | 파일 | 작업 |
| --- | --- | --- |
| Backend 수정 | `backend/app/repositories/applications.py` | `ApplicationRepository` Protocol에 `count_by_request_ids` 추가, `InMemory`/`Postgres` 양쪽 구현 |
| Backend 수정 | `backend/app/repositories/requests.py` | `PurchaseRequestRepository` Protocol에 `list_by_requester` 추가, `InMemory`/`Postgres` 양쪽 구현 |
| Backend 수정 | `backend/app/services/requests.py` | `PurchaseRequestService`에 `applications` 리포지토리 주입, `list_mine` 유스케이스 추가 |
| Backend 수정 | `backend/app/schemas/requests.py` | `MyPurchaseRequestOut(PurchaseRequestOut)` 추가 |
| Backend 수정 | `backend/app/api/requests.py` | `GET /requests/mine` 라우트 추가(`GET /requests/{request_id}`보다 먼저 등록) |
| Backend 수정 | `backend/app/api/dependencies.py` | `PurchaseRequestService(...)` 생성 호출에 `application_repository` 인자 추가 |
| Frontend 수정 | `frontend/src/types/request.ts` | `MyPurchaseRequest` 타입 추가 |
| Frontend 수정 | `frontend/src/features/requests/data/requests-api.ts` | `getMyRequests()` 추가 |
| Frontend 신규 | `frontend/src/app/requests/mine/page.tsx` | 인증 게이트 + 목록 + 지원자 수 표시 |
| 테스트(별도 RED 작업) | `backend/tests/test_requests.py` | 9절 백엔드 수용 기준에 대응하는 계약 테스트 |
| 테스트(별도 RED 작업) | `frontend/tests/features/requests/requests-api.test.ts` | `getMyRequests()` 성공/401/네트워크 실패 케이스 |
| 테스트(별도 RED 작업) | `frontend/tests/app/requests-mine-page.test.tsx`(신규) | 게이트·목록·지원자 수 렌더링 |

## 9. 구현 순서

1. `count_by_request_ids`(applications 리포지토리)와 `list_by_requester`(requests 리포지토리)를 먼저 추가하고 단위 테스트로 고정한다(RED → GREEN).
2. `PurchaseRequestService.list_mine`과 `MyPurchaseRequestOut`을 추가하고, `GET /requests/mine` 계약 테스트(9.1~9.7)를 통과시킨다. 이 시점에 라우트 등록 순서(3절)를 검증하는 회귀 테스트도 함께 추가한다.
3. `dependencies.py`를 갱신해 기존 `GET /requests/{id}` 등 다른 엔드포인트가 깨지지 않는지 확인한다(생성자 시그니처 변경의 파급 확인).
4. 프런트엔드 타입·`getMyRequests()`·`/requests/mine` 페이지를 구현하고 9.8~9.11의 UI 테스트를 통과시킨다.
5. 수동으로 헤더의 "내 구매 요청" 링크를 클릭해 실제 페이지가 뜨는지 확인한다(현재는 404였던 경로).

## 10. 수용 기준

1. 비로그인 상태로 `GET /api/requests/mine`을 호출하면 401 `authentication_required`를 반환한다.
2. 구매요청을 하나도 등록하지 않은 로그인 사용자가 `GET /api/requests/mine`을 호출하면 200과 `[]`를 반환한다.
3. 로그인한 사용자가 구매요청을 2건 등록했고 그중 한 건에 서로 다른 판매자 2명이 지원(하나는 `대기중`, 하나는 `거절됨`)했다면, 그 요청 항목의 `applicationCount`는 `2`이고 지원이 없는 다른 요청 항목의 `applicationCount`는 `0`이다.
4. 다른 사용자가 등록한 구매요청은 `GET /api/requests/mine` 응답에 나타나지 않는다(개수·id 모두 확인).
5. 다른 사용자의 요청에 접수된 지원 건수는 내 요청의 `applicationCount`에 섞이지 않는다.
6. `GET /api/requests/mine`의 응답 배열은 `created_at desc`로 정렬된다(가장 최근에 등록한 요청이 먼저 온다).
7. 지원 하나가 수락되어 같은 요청의 나머지 `대기중` 지원이 자동으로 `거절됨`으로 바뀐 뒤에도(스펙 11 §3.1), 해당 요청의 `applicationCount`는 상태 전이 전후로 총 지원 건수를 그대로 유지한다(상태 무관 카운트라는 1절 정의의 회귀 확인).
8. 비로그인 사용자가 `/requests/mine`에 접근하면 `/login?next=/requests/mine`으로 redirect된다.
9. 구매요청을 등록하지 않은 로그인 사용자가 `/requests/mine`에 접근하면 "아직 등록한 구매요청이 없어요" 안내와 `/requests/new` 링크를 본다.
10. 로그인한 사용자가 지원자 0명인 요청과 2명인 요청을 각각 가지고 있을 때 `/requests/mine`에서: 0명 카드는 "현재 지원자 수: 0명"을 링크가 아닌 텍스트로, 2명 카드는 "현재 지원자 수: 2명"을 `/requests/{id}/applications`로 이동하는 링크로 렌더링한다.
11. `getMyRequests()`가 401 응답 또는 네트워크 실패를 받으면 `{ ok: false }`를 반환하고, 페이지는 이를 근거로 로그인 페이지로 redirect한다(요청이 0건이라 빈 배열이 온 성공 케이스와 혼동하지 않는다).
