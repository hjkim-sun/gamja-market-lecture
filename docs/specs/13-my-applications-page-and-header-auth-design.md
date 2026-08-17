# 13. 내 판매 신청 페이지 실체화 및 헤더 로그인 상태 깜빡임 제거

> 범위: (1) `/applications/mine`이 실제 데이터를 보여주는 인증 게이트 페이지가 되도록 한다. (2) 지원 내역이 0건일 때 에러가 아니라 "신청한 내역이 없다"는 빈 상태 안내를 보여준다. (3) `Header`의 로그인 여부 초기값을 서버에서 내려받아 로그인 사용자에게 로그인 버튼이 잠깐 보였다 사라지는 깜빡임을 없애되, 로그아웃 동작은 그대로 유지한다. `/requests/mine`, 페이지네이션/필터, 지원 취소 등은 범위 밖이다.

## 1. 현재 상태 진단

### 1.1 `/applications/mine`이 요청 상세용 404 화면을 보여주는 이유

`frontend/src/app/applications/` 디렉터리 자체가 없다(`frontend/src/app`에 `applications/mine/page.tsx`가 존재하지 않음). `12-my-account-menu-design.md`가 이미 이 사실을 명시했고("목적지 페이지... 이번 범위에 포함") 헤더 드롭다운·모바일 drawer는 `/applications/mine` 링크(`Header.tsx:126`, `Header.tsx:168`)를 추가했지만, 실제 후속 페이지 작업(§5의 `frontend/src/app/applications/mine/page.tsx` 신규 항목)이 아직 커밋되지 않았다. 매칭되는 라우트가 없으므로 Next.js는 루트 `not-found.tsx`(`frontend/src/app/not-found.tsx`)로 폴백하는데, 이 파일의 문구("요청하신 구매요청이 존재하지 않거나 삭제되었을 수 있어요", CTA "구매요청 목록으로 가기")는 `/requests/[id]`용으로 작성되어 있어 신청 목록과 무관한 "요청 스타일" 404가 보인다. 원인은 라우트 부재이지, `not-found.tsx` 문구 자체의 결함이 아니다 — 이번 스펙은 `not-found.tsx`를 고치지 않고 누락된 라우트를 만든다.

데이터 계층은 이미 존재한다:
- 백엔드: `GET /api/applications/mine` (`backend/app/api/applications.py:23`) — `gm_session` 쿠키로 인증, 무효 시 401(`_authentication_required_response()`), 유효 시 `MyApplicationOut[]` 반환.
- rewrite: `next.config.ts`의 `/api/applications/:path*` → 백엔드, 변경 불필요.
- 프런트: `getMyApplications()` (`frontend/src/features/applications/data/applications-api.ts:32`), 타입 `MyApplication` (`frontend/src/types/application.ts:29`).

### 1.2 `getMyApplications()`의 계약이 페이지가 필요로 하는 것과 다르다

같은 파일의 `getApplicationsForRequest()`(§1.1과 나란히 정의)와 `frontend/src/features/chats/data/chats-api.ts`의 `getMyChatThreads()`는 모두 `{ ok: true; ... } | { ok: false; status: number }` 판별 유니언을 반환해서, 호출자(예: `ChatsPage`)가 401을 "빈 목록"과 구분해 로그인으로 리다이렉트할 수 있다. 반면 `getMyApplications()`는 실패 원인을 구분하지 않고 **모든 실패(401 인증 만료 포함)를 빈 배열 `[]`로 뭉갠다**(`applications-api.ts:44`: `if (!response.ok) return [];`). 이 계약으로는 페이지가 "비로그인 → `/login`으로 보내야 함"과 "로그인 상태인데 신청 내역이 0건"을 구분할 수 없다. 두 상태를 요구사항이 다르게 지시하므로(하나는 인증 게이트, 하나는 빈 상태 안내) `getMyApplications()`를 형제 함수들과 동일한 판별 유니언 계약으로 바꾼다.

### 1.3 헤더 로그인 상태 깜빡임의 원인

`Header`(`frontend/src/components/layout/Header.tsx`)는 클라이언트 컴포넌트이며 `signedIn` state를 `useState(false)`로 초기화한다(`Header.tsx:22`). 마운트 후 `useEffect`가 `fetch("/api/auth/me", ...)`로 실제 로그인 여부를 비동기로 확인해 `setSignedIn`한다(`Header.tsx:29-43`). 이 사이 첫 렌더(및 hydration 직후 몇 프레임)는 항상 `signedIn === false`이므로, 실제로 로그인된 사용자도 "로그인"/"회원가입" 링크(`Header.tsx:131-136`, 모바일 `Header.tsx:171-176`)가 잠깐 보였다가 "내 계정" 메뉴로 바뀐다. `RootLayout`(`frontend/src/app/layout.tsx`)은 서버 컴포넌트인데도 인증 상태를 전혀 조회하지 않고 `<Header />`를 인자 없이 렌더링하므로, 서버가 이미 알 수 있는 정보를 클라이언트가 처음부터 다시 알아내는 구조다.

## 2. 설계

### 2.1 `getMyApplications()` 계약 변경

```ts
export type MyApplicationsResult =
  | { ok: true; applications: MyApplication[] }
  | { ok: false; status: number };

export async function getMyApplications(): Promise<MyApplicationsResult> {
  const { cookie, url } = await getSameOriginRequest("/api/applications/mine");
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: cookie ? { Cookie: cookie } : undefined,
    });
  } catch {
    return { ok: false, status: 0 };
  }

  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true, applications: (await response.json()) as MyApplication[] };
}
```

`getApplicationsForRequest`/`getMyChatThreads`와 동일한 형태(네트워크 예외 → `status: 0`, HTTP 실패 → `status: response.status`, 성공 → `{ ok: true, ... }`)로 맞춘다. 현재 `getMyApplications`의 유일한 호출자는 없으므로(`grep` 결과 정의부 외 참조 없음) 이 변경은 새 `page.tsx`에서만 소비되며 다른 파일을 깨지 않는다.

### 2.2 `frontend/src/app/applications/mine/page.tsx` (신규)

`frontend/src/app/chats/page.tsx`(인증 게이트)와 `frontend/src/app/requests/[id]/applications/page.tsx`(목록 렌더링 + 빈 상태)의 패턴을 그대로 합성한다.

```tsx
import { redirect } from "next/navigation";
import MyApplicationList from "@/features/applications/components/MyApplicationList";
import { getMyApplications } from "@/features/applications/data/applications-api";

export const metadata = {
  title: "내 판매 신청 — 감자마켓",
};

export default async function MyApplicationsPage() {
  const result = await getMyApplications();

  if (!result.ok) {
    redirect("/login?next=/applications/mine");
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-extrabold text-[#4a2f1c] sm:text-3xl">내 판매 신청</h1>
      <p className="mt-2 text-sm text-[#8a6a4a]">
        내가 지원한 구매요청과 진행 상태를 확인할 수 있어요.
      </p>
      <div className="mt-8">
        <MyApplicationList applications={result.applications} />
      </div>
    </div>
  );
}
```

- 인증 실패(`status`가 401이든, 네트워크 예외로 인한 `0`이든)는 모두 로그인 필요로 취급해 `/login?next=/applications/mine`으로 리다이렉트한다 — `ChatsPage`가 `getMyChatThreads()`의 모든 `!ok`를 동일하게 처리하는 것과 같은 단순화이며, 지금 시점에 401 이외의 실패 상태를 구분해 보여줄 UI가 없으므로 과설계하지 않는다.
- 로그인 상태이고 `applications.length === 0`인 정상 케이스는 `!result.ok` 분기를 타지 않고 그대로 `MyApplicationList`에 빈 배열이 전달된다 → §2.3의 빈 상태 문구가 렌더링된다(에러 화면이 아님).

### 2.3 `frontend/src/features/applications/components/MyApplicationList.tsx` (신규)

기존 `ApplicationList`(요청 소유자 뷰, 수락/거절 액션 포함)와 별도 컴포넌트로 둔다 — 이번 스펙은 조회 전용이고 `OwnerApplication`과 `MyApplication`은 필드가 다르므로(`requestTitle` vs `sellerDisplayName`) 액션이 없는 얇은 목록 컴포넌트가 기존 컴포넌트를 억지로 재사용하는 것보다 명확하다.

```tsx
import Link from "next/link";
import type { ApplicationStatus, MyApplication } from "@/types/application";

const STATUS_STYLES: Record<ApplicationStatus, string> = {
  대기중: "bg-amber-100 text-amber-700",
  수락됨: "bg-emerald-100 text-emerald-700",
  거절됨: "bg-stone-200 text-stone-500",
};

export default function MyApplicationList({ applications }: { applications: MyApplication[] }) {
  if (applications.length === 0) {
    return (
      <p className="rounded-2xl bg-white p-6 text-center text-sm text-[#8a6a4a] shadow-sm ring-1 ring-amber-200/60">
        아직 신청한 판매 지원이 없어요.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {applications.map((application) => (
        <li key={application.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-amber-200/60">
          <div className="flex items-center justify-between">
            <Link href={`/requests/${application.requestId}`} className="text-sm font-bold text-[#4a2f1c] hover:underline">
              {application.requestTitle}
            </Link>
            <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[application.status]}`}>
              {application.status}
            </span>
          </div>
          <p className="mt-1 text-lg font-extrabold text-[#d9822b]">{application.offeredPrice.toLocaleString()}원</p>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[#6b5540]">{application.message}</p>
          <p className="mt-2 text-xs text-[#b89a7c]">{application.createdAt} 지원</p>
        </li>
      ))}
    </ul>
  );
}
```

빈 상태 문구("아직 신청한 판매 지원이 없어요")는 기존 `ApplicationList`/`ChatThreadList`의 빈 상태 톤("아직 지원한 판매자가 없어요", "아직 진행 중인 채팅이 없어요")과 같은 어조·같은 스타일 클래스를 재사용한다. 별도 아이콘/일러스트는 추가하지 않는다(기존 빈 상태들도 텍스트만 사용).

### 2.4 헤더 로그인 상태 깜빡임 제거 — 서버 파생 초기값

**핵심 결정: 클라이언트 `useEffect` fetch는 그대로 둔다.** 목적은 초기 렌더 시점의 오탐(깜빡임)을 없애는 것이지, 클라이언트 쪽 재검증(다른 탭에서 로그아웃했거나 세션이 만료된 경우를 잡아내는 용도)을 없애는 것이 아니다. 로그아웃 동작(`handleSignOut`)도 기존 그대로 `setSignedIn(false)` → `router.replace("/")` → `router.refresh()`를 유지한다 — `router.refresh()`가 서버 컴포넌트(`RootLayout`)를 다시 실행시켜 다음 초기값도 로그아웃 상태로 내려오므로, 별도의 유지보수 없이 일관성이 맞는다.

**구현:**

1. `RootLayout`을 async 서버 컴포넌트로 바꾸고, 같은 요청의 쿠키를 그대로 실어 `GET /api/auth/me`를 same-origin으로 호출해 로그인 여부만 판별한다. 기존 `getSameOriginRequest` 헬퍼(`frontend/src/lib/api/same-origin-request.ts`)가 이미 `/api/auth/${string}` 패턴을 허용하므로 재사용한다.

   ```ts
   // frontend/src/features/auth/data/session.ts (신규)
   import { getSameOriginRequest } from "@/lib/api/same-origin-request";

   /** True iff the incoming request carries a valid session, per `GET /api/auth/me`. */
   export async function getIsSignedIn(): Promise<boolean> {
     const { cookie, url } = await getSameOriginRequest("/api/auth/me");
     try {
       const response = await fetch(url, {
         cache: "no-store",
         headers: cookie ? { Cookie: cookie } : undefined,
       });
       return response.ok;
     } catch {
       return false;
     }
   }
   ```

   `12`절 설계 메모가 이미 "`GET /api/auth/me` 확인 → 비로그인이면 redirect" 패턴을 인증 게이트 표준으로 지정했으므로, 같은 엔드포인트를 헤더 초기값에도 재사용해 새 백엔드 개념을 만들지 않는다. Supabase 서버 클라이언트(`lib/supabase/server.ts`)로 직접 세션을 파싱하는 대안은 채택하지 않는다 — 이 앱의 신뢰 원천은 백엔드가 발급하는 `gm_session` 쿠키이지 raw Supabase 쿠키가 아니고(`features/auth/actions/auth.ts`의 `applySessionCookie`가 `gm_session`만 다룸), 이미 검증된 판정 주체(백엔드 `/api/auth/me`)를 그대로 쓰는 편이 판정 로직 이중화를 막는다.

2. `RootLayout`은 이 값을 `Header`에 prop으로 전달한다.

   ```tsx
   // frontend/src/app/layout.tsx
   export default async function RootLayout({ children }: LayoutProps<"/">) {
     const initialSignedIn = await getIsSignedIn();
     return (
       <html ...>
         <body ...>
           <Header initialSignedIn={initialSignedIn} />
           ...
   ```

3. `Header`는 `initialSignedIn`을 prop으로 받아 `useState`의 초기값으로 쓴다. 기존 시그니처를 깨지 않도록 기본값을 둔다(기존 `header-auth-state.test.tsx`/`header-account-menu.test.tsx`는 `Header()`를 인자 없이 직접 호출한다 — 이 두 파일은 `useState`를 모킹해 초기값을 자체 주입하므로 prop 기본값 도입으로 깨지지 않는다).

   ```ts
   export default function Header({ initialSignedIn = false }: { initialSignedIn?: boolean } = {}) {
     ...
     const [signedIn, setSignedIn] = useState(initialSignedIn);
     ...
   ```

   `useEffect` 본문은 변경하지 않는다 — 마운트 후에도 여전히 `/api/auth/me`를 재확인해 `setSignedIn`한다. 서버 값이 맞았다면 클라이언트 fetch는 같은 값으로 재설정할 뿐이라 리렌더는 있어도 화면상 깜빡임(오탐 상태 전환)은 없다.

**부작용 확인:**
- 로그아웃 직후: `handleSignOut`이 `router.refresh()`를 호출하므로 `RootLayout`이 재실행되고 `getIsSignedIn()`이 새 쿠키(로그아웃 후 만료/삭제된 세션)로 `false`를 반환 → 다음 `initialSignedIn={false}`. 클라이언트 state는 이미 `handleSignOut` 안에서 `setSignedIn(false)`로 즉시 반영되어 있어 이중으로 안전하다.
- 서버·클라이언트 값이 갈리는 경우(예: 서버가 만료 임박 세션을 유효로 판정했다가 클라이언트 fetch 시점엔 만료): 클라이언트 `useEffect`가 짧게 재조정한다 — 이는 세션 만료라는 실제 상태 변화이지 렌더링 결함이 아니므로 이번 스펙에서 별도 처리하지 않는다.
- `RootLayout`이 모든 페이지를 감싸므로 `/login`, `/signup` 등 비로그인 페이지에서도 매 요청마다 `/api/auth/me` 호출이 하나 늘어난다. 기존에도 `ChatsPage`/`RequestApplicationsPage` 등 인증 게이트 페이지들이 같은 방식으로 백엔드를 호출하고 있어 새 패턴이 아니며, 이 비용은 이번 스펙에서 최적화 대상으로 삼지 않는다(캐싱/미들웨어 전환은 범위 밖).

## 3. RED 인수 테스트

TDD 오케스트레이션의 Tester 단계에서 아래 테스트를 실패(RED) 상태로 먼저 추가한다. 파일 경로와 기존 테스트의 목킹 관례(`vi.hoisted`, `next/navigation`/`next/headers` 목, `renderToStaticMarkup`)를 그대로 따른다.

### 3.1 `frontend/tests/app/applications-mine-page.test.tsx` (신규)

`request-applications-page.test.tsx`/`chats-page.test.tsx`와 동일한 구조.

```ts
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  getMyApplications: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/features/applications/data/applications-api", () => ({
  getMyApplications: mocks.getMyApplications,
}));

import MyApplicationsPage from "@/app/applications/mine/page";

describe("/applications/mine", () => {
  it("renders the signed-in seller's own applications with request titles and status", async () => {
    mocks.getMyApplications.mockResolvedValue({
      ok: true,
      applications: [{
        id: "application-1",
        requestId: "request-1",
        requestTitle: "닌텐도 스위치 OLED 화이트",
        offeredPrice: 700000,
        message: "동일 모델 재고가 있고 오늘 바로 거래할 수 있습니다.",
        status: "대기중",
        createdAt: "2026-08-17T00:00:00.000Z",
      }],
    });

    const html = renderToStaticMarkup(await MyApplicationsPage());

    expect(html).toContain("닌텐도 스위치 OLED 화이트");
    expect(html).toContain("대기중");
    expect(html).not.toContain("페이지를 찾을 수 없어요");
  });

  it("shows a no-applications message instead of an error when the seller has no applications", async () => {
    mocks.getMyApplications.mockResolvedValue({ ok: true, applications: [] });

    const html = renderToStaticMarkup(await MyApplicationsPage());

    expect(html).toContain("아직 신청한 판매 지원이 없어요");
    expect(html).not.toMatch(/오류|에러|찾을 수 없어요/);
  });

  it.each([401, 0])("redirects an unauthenticated visitor to login with a return path for backend status %s", async (status) => {
    mocks.getMyApplications.mockResolvedValue({ ok: false, status });

    await MyApplicationsPage();

    expect(mocks.redirect).toHaveBeenCalledWith("/login?next=/applications/mine");
  });
});
```

### 3.2 `frontend/tests/features/applications/applications-api.test.ts` (신규)

`getMyApplications()`의 새 판별 유니언 계약을 고정한다(현재 이 파일이 없음 — `applications-actions.test.ts`는 서버 액션만 다룬다).

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ headers: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));

import { getMyApplications } from "@/features/applications/data/applications-api";

describe("getMyApplications", () => {
  beforeEach(() => {
    mocks.headers.mockResolvedValue(new Headers({
      host: "gamja.example",
      "x-forwarded-proto": "https",
      cookie: "gm_session=abc",
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("returns ok:true with the parsed list on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } }),
    ));

    await expect(getMyApplications()).resolves.toEqual({ ok: true, applications: [] });
  });

  it("returns ok:false with the backend status on a 401, instead of silently returning an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    await expect(getMyApplications()).resolves.toEqual({ ok: false, status: 401 });
  });

  it("returns ok:false with status 0 on a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(getMyApplications()).resolves.toEqual({ ok: false, status: 0 });
  });
});
```

### 3.3 `frontend/tests/components/layout/header-initial-auth-state.test.tsx` (신규)

기존 `header-auth-state.test.tsx`의 목킹 패턴을 그대로 쓰되, prop을 검증한다.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useEffect: vi.fn(), useState: vi.fn() }));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useEffect: mocks.useEffect, useRef: () => ({ current: null }), useState: mocks.useState };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/features/auth/actions/auth", () => ({ signOut: vi.fn() }));

import Header from "@/components/layout/Header";

describe("Header initial auth state from the server", () => {
  beforeEach(() => {
    mocks.useEffect.mockReset();
    mocks.useState.mockReset();
    mocks.useEffect.mockImplementation(() => undefined);
  });

  it("seeds the signed-in useState with the server-derived initialSignedIn prop, not a hardcoded false", () => {
    mocks.useState.mockImplementation((initial: unknown) => [initial, vi.fn()]);

    Header({ initialSignedIn: true });

    // The first useState call in Header is the signedIn state (see header-account-menu.test.tsx's
    // documented hook order: signedIn, mobileOpen, accountOpen, loggingOut).
    expect(mocks.useState).toHaveBeenNthCalledWith(1, true);
  });

  it("defaults to false when no initialSignedIn prop is given, so existing call sites keep working", () => {
    mocks.useState.mockImplementation((initial: unknown) => [initial, vi.fn()]);

    Header();

    expect(mocks.useState).toHaveBeenNthCalledWith(1, false);
  });

  it("renders the signed-in account menu on the very first render when initialSignedIn is true, with no interim login link", () => {
    mocks.useState.mockImplementation((initial: unknown) => [initial, vi.fn()]);

    const html = JSON.stringify(Header({ initialSignedIn: true }));

    expect(html).toContain("내 계정");
    expect(html).not.toContain("로그인");
  });
});
```

### 3.4 `frontend/tests/app/root-layout.test.tsx` (신규)

`RootLayout`이 세션을 조회해 `Header`로 전달하는지 검증한다.

```ts
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getIsSignedIn: vi.fn(),
  Header: vi.fn(() => null),
}));

vi.mock("@/features/auth/data/session", () => ({ getIsSignedIn: mocks.getIsSignedIn }));
vi.mock("@/components/layout/Header", () => ({ default: mocks.Header }));
vi.mock("@/components/layout/Footer", () => ({ default: () => null }));

import RootLayout from "@/app/layout";

describe("RootLayout", () => {
  it("passes the server-derived signed-in state to Header instead of letting it start unauthenticated", async () => {
    mocks.getIsSignedIn.mockResolvedValue(true);

    await RootLayout({ children: null } as never);

    expect(mocks.Header).toHaveBeenCalledWith(
      expect.objectContaining({ initialSignedIn: true }),
      expect.anything(),
    );
  });
});
```

## 4. 변경 대상 요약

| 구분 | 파일 | 작업 |
| --- | --- | --- |
| Frontend 수정 | `frontend/src/features/applications/data/applications-api.ts` | `getMyApplications()`를 `{ ok, applications } \| { ok: false, status }` 판별 유니언으로 변경 |
| Frontend 신규 | `frontend/src/app/applications/mine/page.tsx` | 인증 게이트 + `getMyApplications()` 목록 렌더링 |
| Frontend 신규 | `frontend/src/features/applications/components/MyApplicationList.tsx` | 조회 전용 목록 컴포넌트, 빈 상태 문구 포함 |
| Frontend 신규 | `frontend/src/features/auth/data/session.ts` | `getIsSignedIn()` — `GET /api/auth/me` 기반 서버 판정 |
| Frontend 수정 | `frontend/src/app/layout.tsx` | async로 전환, `getIsSignedIn()` 호출 후 `Header`에 `initialSignedIn` 전달 |
| Frontend 수정 | `frontend/src/components/layout/Header.tsx` | `initialSignedIn?: boolean = false` prop 추가, `useState(false)` → `useState(initialSignedIn)` |
| 테스트(RED) | `frontend/tests/app/applications-mine-page.test.tsx` | §3.1 |
| 테스트(RED) | `frontend/tests/features/applications/applications-api.test.ts` | §3.2 |
| 테스트(RED) | `frontend/tests/components/layout/header-initial-auth-state.test.tsx` | §3.3 |
| 테스트(RED) | `frontend/tests/app/root-layout.test.tsx` | §3.4 |

## 5. 수용 기준

1. 로그인한 사용자가 지원한 신청 내역이 있는 상태에서 `/applications/mine`에 접근하면 본인이 지원한 건만 요청 제목·제안가·메시지·상태·등록일과 함께 나타나고, 요청 상세용 404 문구는 어디에도 나타나지 않는다.
2. 로그인한 사용자가 신청한 내역이 하나도 없는 상태에서 `/applications/mine`에 접근하면 "아직 신청한 판매 지원이 없어요" 안내를 보고, 오류/에러 문구는 보이지 않는다.
3. 비로그인 사용자가 `/applications/mine`에 직접 접근하면(또는 세션이 만료된 상태로 접근하면) `next` 파라미터가 보존된 `/login?next=/applications/mine`으로 리다이렉트된다.
4. `getMyApplications()`는 성공 시 `{ ok: true, applications }`를, 401을 포함한 모든 HTTP 실패 시 `{ ok: false, status }`를 반환한다(더 이상 인증 실패를 빈 배열로 감추지 않는다).
5. 이미 로그인된 사용자가 페이지를 새로고침하면 최초 렌더부터 헤더가 "내 계정" 메뉴를 보여주고, "로그인"/"회원가입" 링크가 잠깐이라도 렌더링되지 않는다.
6. `Header`를 `initialSignedIn` prop 없이 호출해도(기존 테스트 호출부 포함) 기본값 `false`로 동작해 기존 비로그인 렌더링 테스트가 깨지지 않는다.
7. 로그아웃 버튼을 누르면 기존과 동일하게 즉시 "내 계정" 메뉴가 사라지고 `/`로 이동하며, 새로고침 후에도 로그인 상태로 되돌아오지 않는다(서버 파생 초기값이 로그아웃 이후 재조회 시 `false`를 반환).
