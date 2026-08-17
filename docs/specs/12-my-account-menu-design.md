# 12. 내 계정 메뉴: 내 구매 요청 · 내 판매 신청

> 구현 상태 (2026-08-17): 이번 증분은 §2의 인증된 내 계정 메뉴 항목과 해당 UI 테스트만 제공합니다. 목적지 페이지·목록 API 및 §3 이후의 확장 동작은 후속 작업 범위입니다.

> 범위: 로그인한 사용자를 위한 헤더 "내 계정" 드롭다운(데스크톱)·모바일 drawer의 "내 계정" 섹션에 정확히 두 개의 메뉴 항목 — `내 구매 요청`, `내 판매 신청` — 을 추가한다. 두 항목이 가리키는 목적지 페이지의 최소 골격(목록 조회 페이지)도 이번 범위에 포함한다 — 목적지가 없는 메뉴 항목은 그 자체로 완결된 기능이 아니기 때문이다. 페이지네이션, 필터/정렬, 요청·지원 상세로의 인라인 액션(취소, 재지원 등)은 범위 밖이며 각각 `08`/`11` 스펙의 기존 상세·목록 페이지로 연결하는 링크만 제공한다.

## 1. 현재 상태와 전환 결정

- `frontend/src/components/layout/Header.tsx`의 `signedIn` 분기는 이미 데스크톱 `gm-account-wrap`(버튼 `내 계정` → `gm-account-menu` 드롭다운에 `로그아웃` 버튼 1개)과 모바일 drawer의 정적 `내 계정` 레이블 + `로그아웃` 버튼을 두고 있다. 이번 스펙은 이 기존 컨테이너에 링크 2개를 끼워 넣는 것이지, 새 메뉴 컨테이너를 만드는 것이 아니다.
- **내 판매 신청**은 백엔드·데이터 계층이 이미 완성돼 있다 (`11-seller-applications-and-buyer-seller-chat-design.md`): `GET /api/applications/mine`(`backend/app/api/applications.py`), `next.config.ts`의 `/api/applications/:path*` rewrite, `frontend/src/features/applications/data/applications-api.ts`의 `getMyApplications()`, `MyApplication` 타입까지 존재한다. **다만 이를 렌더링하는 프런트엔드 페이지(`/applications/mine`)가 아직 없다** — `frontend/src/app`에 `applications/` 디렉터리 자체가 없다. 이 페이지 생성이 이번 스펙의 실제 신규 작업이다.
- **내 구매 요청**은 대응하는 백엔드 엔드포인트가 없다. `GET /api/requests`(`backend/app/api/requests.py`)는 전체 공개 목록만 반환하고 작성자로 필터링하지 않는다. `GET /api/applications/mine`과 동일한 패턴(`gm_session` 쿠키 → 세션 사용자 id → 소유 레코드만 조회)으로 `GET /api/requests/mine`을 신설한다. `next.config.ts`의 `/api/requests/:path*` rewrite는 이미 모든 하위 경로를 포괄하므로 rewrite 변경은 불필요하다.
- 두 목적지 모두 로그인이 전제이므로, `08-purchase-request-registration-design.md`/`11`이 이미 쓰는 서버 컴포넌트 인증 게이트 패턴(`GET /api/auth/me` 확인 → 비로그인이면 `/login?next=<원래 경로>`로 redirect)을 그대로 재사용한다.
- 헤더의 `primaryLinks`(공개 링크: 홈, 구매요청)는 변경하지 않는다. `채팅` 링크는 기존처럼 계정 드롭다운 밖, `signedIn` 분기 안 최상단에 유지한다(11절에서 이미 결정된 배치). 이번 두 항목은 "내 계정" 드롭다운/모바일 섹션 **안**에 둔다 — 대상이 "내 계정 메뉴"로 명시적으로 요청되었고, 조회 대상이 뷰어 자신의 데이터이기 때문이다.

## 2. UI 배치

### 2.1 데스크톱 (`gm-account-menu`)

`내 계정` 버튼 클릭 시 열리는 드롭다운의 항목 순서를 다음과 같이 고정한다(위→아래):

1. `내 구매 요청` — `/requests/mine`
2. `내 판매 신청` — `/applications/mine`
3. 구분선(`gm-account-menu-divider`, 신규 CSS 클래스)
4. `로그아웃` (기존 버튼, 위치 변경 없음)

두 항목은 기존 `<Link>` 기반 nav 항목과 동일하게 `next/link`의 `Link`로 렌더링한다(현재 드롭다운 안의 `로그아웃`만 `<button>`인 것은 동작(사이드이펙트 실행)이지 이동이 아니기 때문 — 이 구분을 유지한다).

### 2.2 모바일 drawer

현재 정적 텍스트인 `<span className="gm-mobile-account">내 계정</span>`는 그대로 두고, 그 아래·`로그아웃` 버튼 위에 동일한 두 링크를 `gm-mobile-link` 스타일로 추가한다(다른 모바일 nav 링크와 동일한 44px 최소 터치 타깃, 클릭 시 `setMobileOpen(false)`).

### 2.3 노출 조건

두 항목은 `signedIn === true`일 때만 렌더링한다(기존 `로그아웃`과 동일 조건). 비로그인 사용자에게는 노출하지 않는다 — 로그인 유도는 기존 `로그인`/`회원가입` 링크가 담당하고, 이 스펙은 새 진입점을 추가하지 않는다.

## 3. 내비게이션 동작

- **라우팅**: `next/link`의 클라이언트 사이드 네비게이션을 사용한다(다른 헤더 링크와 동일). 서버 액션이나 `router.push`는 쓰지 않는다.
- **활성 상태 표시**: 기존 `currentPath(pathname, href)` 헬퍼를 재사용해 `aria-current="page"`를 부여한다. `/requests/mine`은 `/requests`의 하위 경로이므로 `currentPath`의 `startsWith` 규칙이 `/requests` 링크와 `/requests/mine` 링크 양쪽을 동시에 활성으로 표시하지 않도록, 두 항목은 정확히 `pathname === href`로 비교한다(기존 `currentPath`를 그대로 쓰면 `/requests/mine`도 `/requests` 링크를 활성 처리해버리는 오탐이 생기므로, 이 두 항목 전용으로 정확 일치 비교를 쓴다 — `currentPath` 함수 자체는 변경하지 않는다).
- **메뉴 닫힘**: 항목 클릭 시 다른 nav 링크와 동일하게 `setAccountOpen(false)`(데스크톱)/`setMobileOpen(false)`(모바일)를 호출한다.
- **목적지 페이지 최소 동작**:
  - `/requests/mine`: 서버 컴포넌트가 `GET /api/requests/mine`을 세션 쿠키와 함께 호출해 뷰어가 작성한 구매요청만 나열한다(응답 형태는 기존 `PurchaseRequestOut` 배열과 동일 — `제목/상태/희망가/카테고리/등록일`). 각 카드는 `/requests/[id]`로 링크한다. 빈 목록이면 "아직 등록한 구매요청이 없어요" 안내 + `/requests/new` 링크(기존 `/requests` 빈 상태 문구 톤 재사용).
  - `/applications/mine`: 서버 컴포넌트가 기존 `getMyApplications()`를 호출한다(신규 fetch 로직 불필요). 각 행은 요청 제목/제안가/메시지/상태/등록일을 보여주고 `requestId`로 `/requests/[id]`에 링크한다. 빈 목록이면 "아직 지원한 요청이 없어요" 안내 + `/requests` 링크.
  - 두 페이지 모두 비로그인 접근 시 `/login?next=/requests/mine` 또는 `/login?next=/applications/mine`으로 redirect한다(`11`의 `/chats` 게이트와 동일 패턴).

## 4. 접근성 요구사항

- 데스크톱 드롭다운을 정식 메뉴로 취급한다: `gm-account-button`에 `aria-haspopup="menu"`를 추가하고(기존 `aria-expanded`는 유지), `gm-account-menu` 컨테이너에 `role="menu"`, 각 링크/버튼에 `role="menuitem"`을 부여한다.
- **닫힘 트리거 확장**: 현재 드롭다운은 항목 클릭 또는 버튼 재클릭으로만 닫힌다(바깥 클릭·Escape 처리가 없다). 실제 이동 가능한 링크 2개가 추가되므로, 모바일 drawer가 이미 구현한 것과 동일한 수준으로 바깥 클릭 시 닫힘과 `Escape` 키 닫힘(포커스는 `내 계정` 버튼으로 복귀)을 데스크톱 드롭다운에도 추가한다.
- **키보드 포커스 순서**: 드롭다운이 열리면 첫 번째 메뉴 항목(`내 구매 요청`)으로 포커스를 이동한다(모바일 drawer가 열릴 때 `data-menu-close` 버튼으로 포커스를 이동시키는 기존 패턴과 동일한 방식). `Tab`/`Shift+Tab`은 메뉴 항목 3개(두 링크 + 로그아웃) 안에서 순환한다.
- **터치 타깃**: 두 항목 모두 기존 `gm-account-menu button`/`gm-mobile-link` 규칙을 그대로 상속해 최소 44px 높이를 만족한다(신규 CSS 규칙 불필요, 클래스 재사용).
- **스크린리더 레이블**: 링크 텍스트 자체가 목적(`내 구매 요청`, `내 판매 신청`)을 명확히 설명하므로 별도 `aria-label`은 불필요하다. `내 계정` 버튼의 기존 `aria-label="내 계정 메뉴 열기"`는 유지한다.
- 목적지 페이지(`/requests/mine`, `/applications/mine`)의 목록은 각각 `<h1>`으로 페이지 제목을 명시하고, 빈 상태 안내는 카드 나열이 아닌 텍스트로 스크린리더가 "결과 없음"을 바로 알 수 있게 한다(기존 `/requests` 빈 상태 패턴과 동일).

## 5. 변경 대상

| 구분 | 파일 | 작업 |
| --- | --- | --- |
| Backend 신규 | `backend/app/api/requests.py` | `GET /requests/mine` 라우트 추가(로그인 필요, 세션 사용자의 `requester_id` 일치 레코드만 반환) |
| Backend 수정 | `backend/app/services/requests.py`, `backend/app/repositories/requests.py` | 작성자 기준 필터 조회 메서드(`list_by_requester`류) 추가 |
| Frontend 신규 | `frontend/src/features/requests/data/requests-api.ts` | `getMyRequests()` — `getMyApplications()`와 동일한 same-origin fetch 패턴 |
| Frontend 신규 | `frontend/src/app/requests/mine/page.tsx` | 인증 게이트 + 내 구매요청 목록 |
| Frontend 신규 | `frontend/src/app/applications/mine/page.tsx` | 인증 게이트 + `getMyApplications()` 목록 |
| Frontend 수정 | `frontend/src/components/layout/Header.tsx` | 데스크톱 드롭다운·모바일 drawer에 두 링크 추가, `aria-haspopup`/`role`, 바깥 클릭·Escape 닫힘, 진입 포커스 이동 |
| Frontend 수정 | `frontend/src/app/globals.css` | `gm-account-menu-divider` 등 드롭다운 구분선 스타일(필요 시) |
| 테스트(RED, 별도 작업) | `frontend/tests/components/layout/header-account-menu.test.tsx` | 6절 UI 수용 기준 |
| 테스트(RED, 별도 작업) | `frontend/tests/app/requests-mine-page.test.tsx`, `frontend/tests/app/applications-mine-page.test.tsx` | 목적지 페이지 게이트·렌더링 |
| 테스트(RED, 별도 작업) | `backend/tests/test_requests.py` | `GET /requests/mine` 계약 테스트 |

## 6. 수용 기준

1. 로그인 상태에서 헤더 `내 계정` 드롭다운을 열면 항목이 정확히 `내 구매 요청`, `내 판매 신청`, `로그아웃` 3개이며, 이 순서로 나타난다(그 외 항목 없음).
2. 비로그인 상태에서는 헤더에 `내 구매 요청`/`내 판매 신청` 링크가 어디에도(데스크톱·모바일) 렌더링되지 않는다.
3. `내 구매 요청` 링크의 `href`는 `/requests/mine`, `내 판매 신청` 링크의 `href`는 `/applications/mine`이다.
4. `/requests/mine`을 보고 있을 때 `내 구매 요청` 항목에 `aria-current="page"`가 붙고, `내 판매 신청`·`홈`·`구매요청` 등 다른 링크에는 붙지 않는다(그 역도 동일).
5. 모바일 drawer에서도 동일한 두 링크가 `내 계정` 레이블과 `로그아웃` 버튼 사이에 나타나고, 클릭 시 drawer가 닫힌다.
6. 데스크톱 드롭다운이 열린 상태에서 메뉴 바깥을 클릭하거나 `Escape`를 누르면 드롭다운이 닫히고, `Escape`의 경우 포커스가 `내 계정` 버튼으로 돌아온다.
7. 드롭다운이 열리는 즉시 첫 번째 메뉴 항목(`내 구매 요청`)에 포커스가 이동한다.
8. 로그인한 사용자가 구매요청 2건을 등록한 뒤 `/requests/mine`에 접근하면 본인이 등록한 2건만 나타나고(다른 사용자의 요청은 없음), 각 카드는 `/requests/{id}`로 이동한다.
9. 구매요청을 등록하지 않은 로그인 사용자가 `/requests/mine`에 접근하면 빈 상태 안내와 `/requests/new` 링크를 본다.
10. 로그인한 사용자가 다른 요청에 지원한 뒤 `/applications/mine`에 접근하면 본인이 지원한 건만 나타나고(다른 사용자의 지원은 없음), 각 행은 해당 `/requests/{id}`로 이동한다.
11. 비로그인 사용자가 `/requests/mine` 또는 `/applications/mine`에 직접 접근하면 각각 `next` 파라미터가 보존된 `/login?next=/requests/mine`, `/login?next=/applications/mine`으로 redirect된다.
12. `GET /api/requests/mine`은 세션이 없거나 무효하면 401 `authentication_required`를 반환하고, 유효한 세션이면 해당 사용자가 `requester_id`인 구매요청만 `created_at desc`로 반환한다(다른 사용자의 요청은 응답에 없음).
