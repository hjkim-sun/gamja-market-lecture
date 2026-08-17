# 03. FastAPI 기반 회원가입·로그인 구현 설계

> 기준 문서: `02-auth-design-spec.md`  
> 범위: Supabase **Auth** 직접 사용을 중단하고, Supabase PostgreSQL을 FastAPI의 데이터 저장소로만 사용한다. 이메일 인증·역할·표시명은 이번 인증 흐름의 범위 밖이다.

## 1. 현재 상태와 전환 결정

- 현재 프론트엔드는 `supabase.auth.signUp/signInWithPassword/signOut`과 `@supabase/ssr` 세션 갱신을 사용하며, 가입 시 역할과 이메일 인증을 요구한다.
- 백엔드는 health endpoint만 있고, 기존 `profiles` 마이그레이션은 `auth.users` 트리거에 의존한다.
- 전환 후 브라우저는 동일 출처의 `/api/auth/*`만 호출하고, FastAPI가 사용자·세션을 관리한다. Supabase publishable key, Auth callback, 이메일 인증 화면 및 `auth.users` 신규 의존은 제거한다.

## 2. HTTP 계약

모든 요청 본문은 JSON이며 `Content-Type: application/json`이다. 성공 응답에는 비밀번호, 해시, 세션 토큰을 절대 포함하지 않는다.

### `POST /api/auth/signup`

요청:

```json
{ "email": "user@example.com", "password": "password123" }
```

| 상태 | 응답 | 의미 |
| --- | --- | --- |
| 201 | `{ "id": "uuid", "email": "user@example.com" }` | 계정 생성 완료. 세션은 만들지 않는다. |
| 400 | `{ "code": "invalid_input", "message": "..." }` | 이메일 또는 비밀번호 검증 실패 |
| 409 | `{ "code": "email_already_exists", "message": "이미 사용 중인 이메일이에요." }` | 정규화 이메일이 이미 존재 |
| 500 | `{ "code": "signup_failed", "message": "회원가입을 완료하지 못했어요. 잠시 후 다시 시도해주세요." }` | 예상하지 못한 오류 |

### `POST /api/auth/login`

요청은 signup과 같다. 성공 시 응답 본문은 `{ "id": "uuid", "email": "user@example.com" }`이고, `gm_session` 쿠키를 함께 발급한다.

| 상태 | 응답 | 의미 |
| --- | --- | --- |
| 200 | 위 성공 본문 + `Set-Cookie` | 인증 성공 |
| 400 | `invalid_input` | 형식 검증 실패 |
| 401 | `{ "code": "invalid_credentials", "message": "이메일 또는 비밀번호가 올바르지 않아요." }` | 이메일 없음과 비밀번호 불일치를 구별하지 않음 |

### `POST /api/auth/logout`, `GET /api/auth/me`

- logout은 현재 세션을 서버에서 폐기하고 동일 쿠키를 만료시킨 뒤 `204 No Content`를 반환한다. 세션이 없더라도 204로 처리한다.
- me는 유효 세션이면 `{ "id": "uuid", "email": "user@example.com" }`(200), 없거나 만료/폐기면 `401 invalid_session`을 반환한다. Header는 이 endpoint만으로 로그인 여부를 판단한다.
- 프론트엔드는 `credentials: "include"`로 호출한다. 개발·운영 모두 브라우저 기준 같은 출처의 `/api`로 노출해야 쿠키가 first-party로 유지된다. Next rewrite가 별도 FastAPI origin으로 전달할 경우 `Set-Cookie`를 보존하고, FastAPI CORS 허용 origin은 설정값으로 한정한다.

## 3. 검증·저장·세션 보안

- 서버는 email을 문자열인지 확인한 뒤 trim하고 lowercase한 `normalized_email`로 비교·저장한다. 유효 이메일 형식이어야 하며, password는 공백을 제거하지 않은 원문 기준 8자 이상이어야 한다.
- `app_users`에는 UUID `id`, 표시용 `email`, `normalized_email UNIQUE NOT NULL`, `password_hash`, `created_at`을 둔다. 중복 확인은 사전 조회가 아니라 이 unique 제약을 최종 권위로 삼고, unique-violation을 항상 409으로 변환한다. 동시 가입도 같은 결과여야 한다.
- 비밀번호는 FastAPI에서 Argon2id(`pwdlib[argon2]` 권장)의 현재 권장 파라미터로 해시·검증한다. 평문은 DB, 로그, 예외 메시지, URL, analytics, client/session storage에 기록하지 않으며, 비밀번호 불일치 메시지는 계정 존재 여부를 누설하지 않는다.
- 로그인 세션은 32바이트 이상의 CSPRNG 난수 opaque token으로 발급한다. `auth_sessions`에는 token의 SHA-256 해시, `user_id`, `expires_at`, `revoked_at`, `created_at`만 저장하고, 원문 token은 `gm_session` HttpOnly cookie에만 둔다.
- cookie 속성은 `HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`이며 운영에서는 반드시 `Secure`이다. logout은 `revoked_at`을 기록하고 cookie를 만료시킨다. `GET /me`와 보호 API는 해시 조회, 만료, 폐기 여부를 확인한다.
- 데이터베이스 연결 문자열, cookie secure 여부, 허용 CORS origin, session TTL은 서버 환경변수로 관리한다. service-role key와 DB URL은 프론트엔드 환경변수에 두지 않는다.

## 4. 프론트엔드 동작

- `/signup`은 email/password 두 필드만 보낸다. 성공하면 `/login?signup=success`로 이동하며 자동 로그인하지 않는다. 409은 이메일 필드 오류 `이미 사용 중인 이메일이에요.`로 연결한다.
- `/login`은 성공 시 허용된 내부 `next` 또는 `/`로 이동한다. 401은 항상 `이메일 또는 비밀번호가 올바르지 않아요.`로 표시한다.
- Header는 mount 시 `GET /api/auth/me`로 상태를 가져오고, login/logout 후 refresh하여 상태를 갱신한다. Supabase auth-state subscription을 사용하지 않는다.
- `/verify-email`, `/email-verified`, `/auth/callback` 및 재전송 UI는 제거한다. 이메일/비밀번호는 URL과 브라우저 저장소에 전달하지 않는다.

## 5. 정확한 변경 대상

| 구분 | 파일 | 작업 |
| --- | --- | --- |
| DB | `backend/supabase/migrations/<timestamp>_create_app_users_and_sessions.sql` | `app_users`, `auth_sessions`, unique/index/제약을 추가하는 forward migration. 기존 `20260816121000_create_profiles_auth_layer.sql`은 수정하지 않고 legacy로 둔다. |
| Backend | `backend/pyproject.toml` | PostgreSQL driver/ORM, Argon2id password library, settings dependency 추가 |
| Backend | `backend/app/core/config.py` | DB·cookie·CORS 설정 모델 추가 |
| Backend | `backend/app/core/security.py` | password hash/verify, opaque session token/hash 생성 |
| Backend | `backend/app/db/session.py` | DB engine/session dependency 추가 |
| Backend | `backend/app/schemas/auth.py` | signup/login request, public user, error schema 정의 |
| Backend | `backend/app/repositories/users.py` | normalized-email 사용자 조회/생성 및 unique-violation 변환 지원 |
| Backend | `backend/app/repositories/sessions.py` | 세션 생성·검증·폐기 조회 |
| Backend | `backend/app/services/auth.py` | 검증 후 signup/login/logout/me 유스케이스와 cookie 정책 |
| Backend | `backend/app/api/routes/auth.py` | 네 auth HTTP endpoint와 status mapping |
| Backend | `backend/app/api/router.py`, `backend/app/main.py` | auth router 등록 및 제한된 CORS 설정 |
| Frontend | `frontend/src/features/auth/lib/auth-input.ts` | role/displayName 제거, email/password 검증과 safe next 유지 |
| Frontend | `frontend/src/features/auth/actions/auth.ts` | Supabase calls를 same-origin FastAPI fetch로 교체하고 상태 코드 매핑 |
| Frontend | `frontend/src/features/auth/components/SignUpForm.tsx` | 두 필드 UI, 409 field error, login success redirect |
| Frontend | `frontend/src/features/auth/components/LoginForm.tsx` | 미인증/재전송 분기 제거, 401 공통 오류 |
| Frontend | `frontend/src/components/layout/Header.tsx` | `/me` 기반 로그인 상태와 `/logout` 호출로 교체 |
| Frontend | `frontend/src/proxy.ts`, `frontend/next.config.ts` | Supabase session proxy 제거, `/api` FastAPI rewrite 구성 |
| Frontend | `frontend/.env.example`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/README.md` | Supabase Auth public config/dependency/설명 제거, private backend origin 문서화 |
| Frontend 삭제 | `frontend/src/lib/supabase/{client,server,config,proxy}.ts`, `frontend/src/app/auth/callback/route.ts`, `frontend/src/app/verify-email/page.tsx`, `frontend/src/app/email-verified/page.tsx`, `frontend/src/features/auth/components/VerifyEmail.tsx` | 직접 Auth, callback, verification 화면 제거 |
| 테스트(별도 RED 작업) | `backend/tests/test_auth.py`, `frontend/tests/features/auth/auth-input.test.ts`, `frontend/tests/app/auth-callback-route.test.ts`, `frontend/tests/app/email-verified-page.test.tsx` 및 auth form/header 테스트 | 새 계약을 먼저 검증하고, callback/verification tests는 해당 파일 삭제와 함께 제거 또는 대체 |

## 6. 구현 순서와 수용 기준

1. DB migration과 backend contract를 구현하고, duplicate-email 경쟁 요청도 409이 되는지 확인한다.
2. frontend를 same-origin API와 cookie session으로 전환한 뒤 Supabase Auth 파일·의존을 제거한다.
3. 새 가입 성공(자동 로그인 없음), 대소문자 중복 409, 평문 미저장, 로그인 성공/401, logout 뒤 me 401, open redirect 차단을 자동 테스트한다.

기존 Supabase `auth.users`/`profiles`에 실제 운영 사용자가 있다면, 삭제나 데이터 이전은 별도 승인 범위다. 이 문서는 신규 앱 사용자 테이블로의 전환만 정의하며 기존 Auth 계정의 자동 마이그레이션을 가정하지 않는다.
