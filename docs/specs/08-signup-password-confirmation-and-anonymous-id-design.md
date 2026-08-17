# 08. 회원가입 비밀번호 확인 및 공개 표시 이름(익명 아이디) 구현 설계

> 기준 문서: `02-auth-api-implementation-design.md` (현재 구현된 회원가입/로그인 계약)
> 범위: `/signup`에 비밀번호 확인 입력과 사용자가 직접 입력하는 공개 표시 이름(요구사항상 "익명 아이디") 입력을 추가한다. 로그인·로그아웃·세션 계약은 변경하지 않는다.
>
> **정정 이력:** 최초안은 익명 아이디를 시스템이 자동 생성하는 값으로 설계했으나, 실제 요구사항은 **회원가입 화면에서 사용자가 직접 입력하는 필수 공개 표시명**이다. 자동 생성·재발급·충돌 재시도 관련 설계는 전부 폐기하고 본 문서로 대체한다. 비밀번호 확인도 최초안(클라이언트 전용 검증)에서 **프런트엔드 서버 액션과 백엔드 API 양쪽에서 일치를 검증**하는 것으로 정정한다.

## 1. 현재 상태 조사 요약

- 백엔드 `SignupRequest`(`backend/app/schemas/auth.py`)는 `email`, `password` 두 필드만 받는다. `LoginRequest`는 현재 `class LoginRequest(SignupRequest)`로 선언되어 있어, `SignupRequest`에 필드를 더하면 그대로 로그인에도 강제된다는 점에 주의해야 한다(§3.3에서 상속 구조를 변경한다).
- `AuthService.signup`(`backend/app/services/auth.py`)은 비밀번호를 해시해 `UserRepository.create`에 저장하고, 저장은 `app_users.normalized_email` UNIQUE 제약을 최종 권위로 삼아 충돌을 409로 변환한다(사전 조회 금지). 이 이메일 중복 처리 방식은 이번 변경과 무관하며 그대로 유지한다.
- `app_users` 테이블(`backend/supabase/migrations/20260816130500_create_app_users.sql`)에는 `id`, `email`, `normalized_email`, `password_hash`, `created_at`만 있다. 공개 표시 이름을 담을 컬럼이 없다.
- 요청 검증 실패(이메일 형식, 비밀번호 8자 미만)는 pydantic `field_validator`가 `ValueError`를 던지고, `backend/app/main.py`의 전역 `RequestValidationError` 핸들러가 이를 고정 메시지("이메일 주소와 비밀번호를 확인해주세요.")의 400 `invalid_input`으로 변환한다. 이 핸들러는 필드별 메시지를 구분하지 않는 **하나의 뭉뚱그린 400**이라는 점이 이번 설계에도 그대로 적용된다.
- 프론트 `SignUpForm.tsx`는 이메일·비밀번호 두 필드만 렌더링하며, 비밀번호는 8자 이상만 클라이언트에서 검사한다. 비밀번호 확인(재입력)과 표시 이름 입력이 없다.
- 저장소 전체를 검색한 결과 "익명 아이디"·표시 이름에 대한 기존 코드는 없다. 과거 아카이브 스펙(`docs/archive/docs/specs/auth-and-profile.md`)의 "닉네임"(2~20자, UNIQUE, 가입 후 별도 온보딩에서 입력)은 이번 요구사항과 다르다: 이번 값은 **가입 화면에서 즉시 입력**하고 **고유성을 요구하지 않는다**.
- `PublicUser` 스키마는 `id`, `email`만 반환하며 signup(201)/login(200)/me(200) 세 응답 모두 이 스키마를 공유한다.

## 2. 비밀번호 확인 설계

### 2.1 요구사항과 설계 결정

- 비밀번호 확인 입력값(`passwordConfirmation`)은 회원가입 요청에 **포함되어 서버로 전송**되며, **프런트엔드 서버 액션**과 **백엔드 API** 양쪽에서 각각 `password`와 일치하는지 검증한다. 한쪽만 검증하는 것은 요구사항을 충족하지 못한다.
- 두 계층에서 검증하는 이유: 프런트엔드 검증은 즉각적인 사용자 피드백(오탈자 방지)을 위한 것이고, 백엔드 검증은 서버 액션을 우회한 직접 API 호출(다른 클라이언트, 재전송, 테스트 등)에서도 동일한 정합성을 보장하기 위한 것이다. 기존 코드베이스가 이메일 형식·비밀번호 길이를 프런트와 백엔드 양쪽에서 이중 검증하는 것과 같은 패턴이다.
- 값 자체는 비밀번호와 마찬가지로 절대 저장하지 않는다. DB에는 여전히 `password_hash`만 남고, 요청 처리 후 `password_confirmation`은 어디에도 영속화되지 않는다.
- 와이어 필드명은 백엔드 pydantic 필드명과 그대로 맞춰 `password_confirmation`(스네이크 케이스)으로 정한다. 프런트엔드 내부 타입/폼 필드명은 관용적인 TypeScript 표기인 `passwordConfirmation`을 쓰고, 서버 액션이 요청 본문을 만들 때 명시적으로 `password_confirmation` 키로 매핑한다(백엔드에 camelCase 별칭 설정을 추가하지 않기 위함).

### 2.2 백엔드 스키마·검증 (`backend/app/schemas/auth.py`)

- 공통 이메일/비밀번호 필드와 검증기를 `CredentialsRequest` 기반 클래스로 분리한다(기존 `SignupRequest`의 `normalize_and_validate_email`/`validate_password_length`를 그대로 옮긴다).
- `LoginRequest(CredentialsRequest)`로 변경해, 로그인 요청에는 `password_confirmation`·`display_name`이 절대 강제되지 않도록 한다(§1에서 지적한 현재의 잘못된 상속 구조를 바로잡는 부분).
- `SignupRequest(CredentialsRequest)`에 `password_confirmation: str`을 추가하고, `model_validator(mode="after")`로 `password_confirmation == password`인지 확인한다. 불일치 시 `ValueError`를 던져 기존 `RequestValidationError` 경로(400 `invalid_input`)를 그대로 탄다 — 새 에러 코드를 만들지 않는다.
- `display_name` 필드는 §3.3에서 같은 `SignupRequest`에 함께 추가한다.

### 2.3 프런트엔드 서버 액션 (`frontend/src/features/auth/actions/auth.ts`, `frontend/src/features/auth/lib/auth-input.ts`)

- `auth-input.ts`에 `SignUpInput = AuthCredentials & { passwordConfirmation: string; displayName: string }` 타입을 추가하고, 전용 `parseSignUpForm(formData): InputResult<SignUpInput>`을 구현한다(더 이상 로그인과 동일한 `parseCredentials` 결과를 그대로 반환하지 않는다 — 로그인은 계속 `parseCredentials`만 쓰는 `parseSignInForm`을 그대로 유지).
  - 이메일/비밀번호 검증은 기존 `parseCredentials`가 하던 로직을 재사용한다.
  - `passwordConfirmation`은 trim하지 않고 원문 그대로 `password`와 정확히 일치하는지 비교한다(비밀번호 자체를 trim하지 않는 기존 규칙과 동일한 이유 — 끝 공백도 비밀번호의 일부다). 불일치 시 `{ ok: false, message: "비밀번호가 일치하지 않아요." }`를 반환한다.
  - `displayName` 검증은 §3.4에서 함께 정의한다.
- `signUp(formData)`(`actions/auth.ts`)가 백엔드로 보내는 JSON 본문에 `password_confirmation: parsed.data.passwordConfirmation`, `display_name: parsed.data.displayName`을 추가한다.
- 서버 액션은 백엔드가 400 `invalid_input`을 반환하는 모든 경우(이메일 형식, 비밀번호 길이, 비밀번호 불일치, 표시 이름 길이)를 이미 처리 중인 "가입을 완료하지 못했어요" 계열 일반 오류 분기로 받는다 — 프런트엔드 자체 검증을 통과한 요청이 서버에서 재차 실패하는 경우는 클라이언트-서버 검증 규칙이 어긋난 버그이므로, 이 경로는 사용자에게 필드별 원인을 보여주기보다 일반 오류로 처리해도 무방하다(기존 이메일/비밀번호와 동일한 방침).

### 2.4 `SignUpForm.tsx` UI 동작

- 비밀번호 입력 아래에 `AuthField`(기존 컴포넌트 재사용, `type="password"`, `name="passwordConfirmation"`, `autoComplete="new-password"`)를 추가한다.
- `FieldErrors` 타입에 `passwordConfirmation`을 추가한다.
- 제출 시 클라이언트 사전 검증(네트워크 왕복 없이 즉시 피드백) 순서: 이메일 형식 → 표시 이름 1~40자(§3.4) → 비밀번호 8자 이상 → 비밀번호와 비밀번호 확인 일치. 불일치 시 "비밀번호가 일치하지 않아요."를 확인 필드에 표시하고 포커스를 옮긴다. `focusFirstError`의 우선순위를 email → displayName → password → passwordConfirmation 순으로 확장한다.
- 이 클라이언트 사전 검증은 §2.3의 서버 액션 검증을 대체하지 않는다 — 폼이 아닌 경로(예: JS 비활성, 자동화 도구)로 서버 액션이 직접 호출되는 경우에도 서버 액션이 최종 검증 주체다.
- 붙여넣기(paste)를 막지 않는다 — 비밀번호 관리자 사용을 방해하지 않기 위해 `onPaste` 차단 등은 추가하지 않는다.

## 3. 공개 표시 이름(요구사항상 "익명 아이디") 설계

### 3.1 요구사항 정정

- **정정: 시스템 자동 생성이 아니다.** 회원가입 화면에서 사용자가 직접 입력하는 **필수** 공개 표시명이다. 예: `날아오르는 감자`.
- 검증 규칙은 정확히 다음과 같다: **trim 후 1자 이상 40자 이하**. 그 외 문자 종류 제한이나 금칙어 필터는 요구사항에 없으므로 이번 범위에 넣지 않는다.
- **고유성을 요구하지 않는다.** 여러 사용자가 같은 표시 이름을 가질 수 있으며, DB에 UNIQUE 제약을 두지 않고 애플리케이션에도 중복 검사·충돌 재시도 로직을 두지 않는다. 최초안에 있던 자동 생성·형식 정규식(`감자[0-9]{7}`)·충돌 시 재시도·`AnonymousIdAlreadyExistsError` 등은 전부 해당 사항이 없다.

### 3.2 필드명

- 이번 값은 사용자가 입력하는 일반적인 "표시 이름"이므로 코드 전반에서 `display_name`(백엔드 와이어/DB), `displayName`(프런트엔드 TS)으로 명명한다. `anonymous_id`라는 이름은 쓰지 않는다 — 요구사항 문서상의 표현("익명 아이디")은 이 필드의 **역할**(실명·이메일 대신 노출되는 익명성 있는 이름)을 설명하는 것이지, 시스템이 부여하는 별도 ID 개념이 아니기 때문이다.

### 3.3 데이터 모델 변경

- `backend/supabase/migrations/<timestamp>_add_display_name_to_app_users.sql`(신규, 예: `20260817060000_add_display_name_to_app_users.sql`)에서 `app_users`에 컬럼을 추가한다:
  - `display_name text not null`
  - `constraint app_users_display_name_length check (char_length(trim(display_name)) between 1 and 40)`
  - UNIQUE 제약은 두지 않는다.
- 기존 `20260816130500_create_app_users.sql`은 수정하지 않고, 새 마이그레이션에서 `alter table ... add column`으로 컬럼을 더한다. 아직 운영 사용자가 없다는 전제(02번 문서 §6)를 그대로 따르며, 기존 행이 있다면 `not null` 추가 전에 기본값 채움이 필요하나 이는 별도 승인 범위다.
- RLS/권한은 `app_users`에 이미 걸린 정책(`anon`, `authenticated`에서 전체 revoke)을 그대로 상속하므로 추가 정책은 필요 없다.

### 3.4 백엔드 스키마·계층 변경

- `backend/app/schemas/auth.py`
  - `SignupRequest`(§2.2에서 `CredentialsRequest`를 상속하도록 재구성)에 `display_name: str` 필드와 전용 `field_validator`를 추가한다: 값을 trim한 뒤 길이가 1~40이 아니면 `ValueError`. 저장·응답에는 trim된 값을 사용한다(원문 앞뒤 공백은 버린다).
  - `PublicUser`에 `display_name: str`을 추가한다. `anonymous_id` 필드는 추가하지 않는다(최초안 폐기).
- `backend/app/repositories/users.py`
  - `AppUser` dataclass에 `display_name: str`을 추가한다.
  - `UserRepository.create(...)`에 `display_name: str` 인자를 추가한다. 고유성이 없으므로 최초안의 충돌 예외·재시도 관련 타입(`AnonymousIdAlreadyExistsError` 등)은 도입하지 않는다 — 기존 `EmailAlreadyExistsError` 처리만 그대로 유지한다.
  - `PostgresUserRepository.create`의 INSERT 문에 `display_name` 컬럼을 추가한다. `IntegrityError` 처리 로직은 기존 이메일 유니크 제약 하나만 다루므로 변경할 필요가 없다(표시 이름에는 유니크 제약이 없기 때문).
  - `InMemoryUserRepository`도 `display_name`을 저장·반환하도록 필드를 추가한다(중복 검사 불필요).
- `backend/app/services/auth.py`
  - `AuthService.signup`이 `request.display_name`을 그대로 `self._users.create(...)`에 전달한다. 값 생성·재시도 로직은 없다(최초안의 익명 아이디 생성 루프는 전부 제거).
- `backend/app/main.py`
  - 전역 `invalid_input_handler`의 고정 메시지 "이메일 주소와 비밀번호를 확인해주세요."는 이제 표시 이름·비밀번호 확인 실패도 같은 400으로 묶이므로 더 이상 정확하지 않다. 메시지를 "입력값을 확인해주세요."처럼 필드를 특정하지 않는 문구로 바꾼다. 이 핸들러는 auth 라우트 전용이 아니라 앱 전역 `RequestValidationError` 핸들러이므로, 문구 변경이 다른 엔드포인트의 400 응답에도 영향을 준다는 점을 구현 시 확인한다(현재는 auth 엔드포인트만 존재하므로 실질적 영향은 없다).

### 3.5 API 계약 변경

- `POST /api/auth/signup` 요청 본문이 `{ "email": "...", "password": "...", "password_confirmation": "...", "display_name": "..." }`로 확장된다. `POST /api/auth/login` 요청 본문은 `{ "email": "...", "password": "..." }`로 **변경 없음**(§2.2의 상속 구조 정정으로 보장).
- signup(201)/login(200)/me(200) 세 응답 모두 `PublicUser`에 추가된 `display_name`을 포함한다. 02번 문서의 예시 응답(`{ "id": "uuid", "email": "user@example.com" }`)은 이 필드만큼 확장되며, 다른 상태 코드·에러 계약은 변경하지 않는다.
- 400 `invalid_input`을 유발하는 경우가 이메일 형식·비밀번호 8자 미만에 더해 "비밀번호와 확인이 다름", "표시 이름이 비어있거나 40자 초과"까지 늘어난다. 응답 형식(코드·메시지)은 기존과 동일하게 유지한다(§3.4에서 메시지 문구만 더 일반적으로 조정).

## 4. 정확한 변경 대상

| 구분 | 파일 | 작업 |
| --- | --- | --- |
| DB | `backend/supabase/migrations/<timestamp>_add_display_name_to_app_users.sql` | `app_users.display_name` 컬럼과 길이 체크 제약 추가(UNIQUE 없음) |
| Backend | `backend/app/schemas/auth.py` | `CredentialsRequest` 기반 클래스 도입, `LoginRequest(CredentialsRequest)`로 정정, `SignupRequest`에 `password_confirmation`·`display_name` 필드와 검증기(비밀번호 일치, 표시 이름 trim/길이) 추가, `PublicUser.display_name` 추가 |
| Backend | `backend/app/repositories/users.py` | `AppUser.display_name`, `create()` 인자 추가(Postgres/InMemory 모두) |
| Backend | `backend/app/services/auth.py` | `signup()`이 `display_name`을 그대로 저장소에 전달하도록 변경 |
| Backend | `backend/app/main.py` | `invalid_input_handler`의 고정 메시지를 필드 비특정 문구로 조정 |
| Backend 테스트 | `backend/tests/test_auth.py` | signup 응답에 요청한 `display_name`(trim 적용)이 그대로 포함되는지, `password_confirmation` 불일치 시 400 `invalid_input`인지, 로그인 요청에는 `password_confirmation`/`display_name`이 필요 없는지, 서로 다른 두 사용자가 같은 `display_name`으로 가입해도 둘 다 201인지(고유성 없음) 검증 |
| Frontend | `frontend/src/features/auth/lib/auth-input.ts` | `SignUpInput` 타입, 전용 `parseSignUpForm`(표시 이름·비밀번호 확인 검증 포함) 추가. `parseSignInForm`은 변경 없음 |
| Frontend | `frontend/src/features/auth/actions/auth.ts` | `signUp()` 요청 본문에 `password_confirmation`, `display_name` 추가 |
| Frontend | `frontend/src/features/auth/components/SignUpForm.tsx` | 표시 이름·비밀번호 확인 `AuthField` 추가, `FieldErrors` 확장, 검증 순서와 포커스 이동 확장 |
| Frontend 테스트 | `frontend/tests/features/auth/auth-input.test.ts`, `frontend/tests/features/auth/auth-actions-signup.test.ts`, SignUpForm 컴포넌트 테스트 | 표시 이름 1~40자(trim 포함) 검증, 비밀번호 불일치 시 제출 차단, 서버 액션이 `password_confirmation`/`display_name`을 요청 본문에 포함해 전송하는지 검증 |

## 5. 구현 순서와 수용 기준

1. **백엔드**: 마이그레이션 적용 → `schemas/auth.py`(상속 구조 정정 포함)·`repositories/users.py`·`services/auth.py`·`main.py` 변경 → signup/login/me 응답과 각 실패 케이스를 자동 테스트로 확인한다.
2. **프런트엔드**: `auth-input.ts`에 표시 이름·비밀번호 확인 검증을 추가하고, `actions/auth.ts`와 `SignUpForm.tsx`를 연결한 뒤, 서버 액션이 두 값을 실제로 요청 본문에 담아 보내는지 테스트한다.
3. 수용 기준:
   - AC1: 회원가입 화면에 표시 이름 입력란이 있고, 비워두거나 공백만 입력하면 제출이 서버로 전송되지 않으며 오류가 표시된다.
   - AC2: 앞뒤 공백을 포함해 41자 이상인 표시 이름은 거부되고, trim 후 1~40자인 값은 trim된 형태로 저장·응답된다.
   - AC3: 서로 다른 두 사용자가 동일한 표시 이름으로 각각 가입해도 둘 다 성공(201)한다 — 표시 이름에 고유성 제약이 없다.
   - AC4: 비밀번호와 비밀번호 확인이 다르면 (a) 프런트엔드 서버 액션 호출 이전에 클라이언트 검증으로 차단되고, (b) 서버 액션·백엔드 API를 직접 불일치 값으로 호출해도 400 `invalid_input`을 받는다(즉, 검증이 클라이언트 자바스크립트에만 의존하지 않는다).
   - AC5: `password_confirmation` 값은 어떤 경우에도 DB나 로그에 저장되지 않는다.
   - AC6: `POST /api/auth/login` 요청은 `password_confirmation`·`display_name` 없이 `email`/`password`만으로 계속 동작한다(회귀 없음).
   - AC7: 가입에 성공하면 signup/login/me 세 응답 모두에 요청 시 입력한(trim된) `display_name`이 포함된다.

## 6. 범위 밖 / 후속 과제

- 표시 이름을 헤더(`Header.tsx`)나 다른 화면에 표시하는 UI 작업(이번 범위는 저장·응답 계약까지).
- 표시 이름 변경 기능, 변경 이력, 변경 횟수 제한.
- 표시 이름에 대한 금칙어·비속어 필터링(요구사항에 없음, 고유성처럼 이번 범위에서 제외).
- 비밀번호 재설정 흐름에서의 비밀번호 확인 UX(현재 비밀번호 재설정 자체가 02번 문서에서 범위 밖으로 명시되어 있다).
