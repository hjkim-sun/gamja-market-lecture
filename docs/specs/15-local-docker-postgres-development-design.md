# 15. 로컬 Docker PostgreSQL 개발 환경 설계

## 목적

로컬 개발이 운영 Supabase PostgreSQL 프로젝트에 직접 쓰기를 하지 않도록, `backend/supabase/migrations`의 이식 가능한 스키마를 그대로 재생하는 로컬 Docker PostgreSQL 환경을 제공한다. 애플리케이션 코드는 이미 `DATABASE_URL` 환경 변수 하나로 백엔드가 붙는 PostgreSQL을 교체할 수 있게 되어 있으므로(아래 "현재 상태" 참고), 이번 설계는 새 스키마나 리포지토리 코드를 만들지 않고 **컨테이너 오케스트레이션 + 마이그레이션 재생 도구 + 문서**만 추가한다.

## 현재 상태와 문제

- `backend/app/repositories/*.py`의 모든 `Postgres*Repository`는 `os.getenv("DATABASE_URL")`이 설정된 경우에만 `psycopg.connect(database_url)`로 직접 연결하고, 미설정 시 `InMemory*Repository`로 폴백한다(예: `backend/app/repositories/users.py:172`). ORM이나 커넥션 풀 계층이 없어 `DATABASE_URL`만 바뀌면 백엔드 코드 수정 없이 대상 PostgreSQL을 교체할 수 있다.
- 그런데 이 워크스페이스의 실제 `backend/.env`는 `DATABASE_URL=postgresql://postgres:...@db.ksnwcdiktoqulrujodof.supabase.co:5432/postgres`로, **운영(호스티드) Supabase 프로젝트를 직접 가리키고 있다.** `backend/.env.example`은 이미 `postgresql://postgres:your-local-password@localhost:5432/gamja_market` 형태의 로컬 접속 문자열을 예시로 두고 있어(로컬 DB가 의도된 설계임을 시사), 실제로 로컬 PostgreSQL을 띄우는 도구는 아직 없다.
- `mcp__supabase__list_projects` 조회 결과 해당 프로젝트(`gamja-lecture`, ref `ksnwcdiktoqulrujodof`)는 PostgreSQL 엔진 **17**(`17.6.1.155`)을 사용한다. 로컬 이미지 버전 선택의 기준이 된다.
- 프런트엔드(`frontend/src/lib/supabase/*`)는 `@supabase/ssr`로 Supabase Auth(GoTrue)에 직접 로그인/이메일 인증(`app/auth/callback`, `VerifyEmail.tsx`)을 수행한다. 이 경로는 로컬 PostgreSQL 컨테이너만으로 대체할 수 없다(아래 "이식 불가" 참고).
- 저장소에는 Docker 관련 파일이나 `supabase` CLI(`supabase start`, `config.toml` 등) 사용 흔적이 없다. 마이그레이션은 순수 SQL 파일로만 존재하며 별도 CLI 없이 적용되어 왔다.

## 이식 가능한 스키마 vs Supabase 관리 스키마

`backend/supabase/migrations/`의 11개 파일을 검토한 결과:

### 이식 가능 (로컬 Docker PostgreSQL에 그대로 적용 가능)

일반 PostgreSQL 기능(테이블, 인덱스, `check` 제약, `references`)만 사용하고 `auth.*`/`storage.*` 스키마나 Supabase 전용 함수에 의존하지 않는다. `app_users`가 유일한 사용자 원장이며 `auth.users`를 참조하지 않는다는 점이 이식성을 보장한다.

| 파일 | 대상 테이블 |
|---|---|
| `20260816130500_create_app_users.sql` | `public.app_users` |
| `20260817021000_create_auth_sessions.sql` | `public.auth_sessions` |
| `20260817030000_create_purchase_requests.sql` | `public.purchase_requests` |
| `20260817060000_add_display_name_to_app_users.sql` | `app_users` 컬럼 추가 |
| `20260817070000_create_request_applications.sql` | `public.request_applications` |
| `20260817070100_create_chat_threads.sql` | `public.chat_threads` |
| `20260817070200_create_chat_messages.sql` | `public.chat_messages` |
| `20260817100100_create_request_images.sql` | `public.request_images` |
| `20260817100200_create_application_images.sql` | `public.application_images` |

이 9개 파일 전체가 이식 가능한 하위 집합이다. `gen_random_uuid()`, `uuid-ossp`, `pgcrypto` 등 확장에 의존하는 구문은 없다(UUID는 백엔드 서비스 계층 `uuid.uuid4()`가 생성해 애플리케이션에서 넘긴다). 다만 모든 이식 가능 파일이 `revoke all on table … from anon, authenticated`를 실행하므로, **로컬 PostgreSQL에 `anon`, `authenticated` 롤이 미리 존재해야** 마이그레이션이 오류 없이 재생된다(Supabase 플랫폼은 이 두 롤을 자동 생성하지만 순정 `postgres` 이미지에는 없다). 이는 "초기화 전략"에서 명시적으로 다룬다.

### 이식 불가 (Supabase 관리형 서비스에 의존)

| 파일 | 이유 |
|---|---|
| `20260816121000_create_profiles_auth_layer.sql` | `auth.users`를 참조(FK)하고, `auth.users`에 트리거를 걸며, `auth.uid()`를 호출한다. 이 스키마들은 Supabase Auth(GoTrue)가 관리하며 순정 PostgreSQL에는 존재하지 않는다. |
| `20260817100000_create_image_storage_buckets.sql` | `storage.buckets`에 삽입한다. `storage` 스키마는 Supabase Storage 서비스가 관리하며 파일 저장·서명 URL 발급 로직도 함께 필요하다. |

**애플리케이션 차원의 함의**: 프런트엔드 회원가입/이메일 인증(`profiles` + `auth.users` 트리거)과 이미지 스토리지(`storage.buckets` + `SupabaseImageStorage` 어댑터, `backend/app/core/storage.py`)는 로컬 Docker PostgreSQL만으로는 재현되지 않는다. 백엔드는 이미 `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` 미설정 시 `InMemoryImageStorage`로 폴백하므로(`create_image_storage()`), 로컬 DB 작업 중 이미지 업로드 경로는 기존처럼 인메모리로 검증하면 된다. Auth/GoTrue 의존 플로우(가입, 이메일 인증)는 계속 호스티드 Supabase 프로젝트(또는 별도 `supabase start` 전체 스택)로만 검증 가능하며, 이는 이번 설계의 스코프 밖임을 명시한다.

## 초기화 및 마이그레이션 전략

### 원칙: 단일 진실 공급원 유지

`backend/supabase/migrations/*.sql` 파일은 수정·복제하지 않는다. 로컬 재생 도구는 이 파일들을 **바이트 그대로** 읽어 실행함으로써, 로컬과 운영이 같은 제약·인덱스·기본값을 갖도록 보장한다. 이식 불가 파일은 별도의 "제외 목록"으로만 건너뛰고, 파일 자체나 파일명은 바꾸지 않는다.

### 제외 목록 관리

제외 목록(위 표의 2개 파일)은 재생 도구 코드 안에 하드코딩하지 않고 검토 가능한 매니페스트로 분리할 것을 권고한다(예: 파일명과 사유를 한 줄씩 적은 텍스트/JSON 매니페스트). 새 마이그레이션 파일이 추가되면:

- 매니페스트에 없고 `auth.`/`storage.`/`vault.`/`extensions.`/`auth.uid(`/`auth.jwt(` 등 Supabase 전용 참조가 없는 파일 → 이식 가능한 것으로 간주해 자동 적용.
- 위 패턴을 포함하는데 매니페스트에 없는 파일 → 재생 도구가 **명시적으로 실패**해 개발자가 이식 가능 여부를 판단하고 매니페스트를 갱신하도록 강제한다(자동 스킵 금지 — 조용한 스키마 드리프트를 막기 위한 fail-closed 원칙).

### 롤 스텁 생성

재생 도구는 마이그레이션 적용 전에 로컬 DB에 `anon`, `authenticated` NOLOGIN 롤이 없으면 생성한다. 이 롤들은 PostgREST/GoTrue 없이 존재하는 빈 껍데기로, `grant`/`revoke` 문이 오류 없이 실행되게 하는 목적만 가지며 실제 RLS 강제(PostgREST 경유 접근)는 로컬에서 재현되지 않는다는 점을 문서화한다. 다만 백엔드가 오늘도 이미 특권 `postgres` 롤로 직접 연결해 RLS를 우회하고 있으므로(운영 `DATABASE_URL`도 `postgres` 사용자), 이는 기존 운영 동작과 동일한 한계이지 로컬 환경이 새로 만든 회귀가 아니다.

### 적용 순서와 재실행 안전성(멱등성)

마이그레이션 파일 자체(`create table`, `add column` 등)는 재실행에 안전하지 않다(존재하는 객체를 다시 만들면 오류). 따라서 재생 도구는 파일명을 기록하는 자체 원장 테이블(예: 로컬 전용 스키마의 `applied_migrations(filename text primary key, applied_at timestamptz)`)을 두고, 이미 기록된 파일은 건너뛴다. 이 원장 테이블은 재생 도구가 스스로 생성하며 `backend/supabase/migrations`에는 추가하지 않는다(운영 Supabase 마이그레이션 이력과 섞이지 않도록).

### 명령어 인터페이스 (제안)

기존 `scripts/dev.sh <backend|frontend|all> <start|stop|restart>`, `scripts/pull-env.sh` 명명 규칙을 따라 루트에 새 컨트롤러를 둔다.

```text
scripts/db-local.sh <up|down|reset|migrate|status>
```

- `up`: 루트의 `docker-compose.local.yml`로 `postgres:17` 컨테이너를 백그라운드로 기동하고 `pg_isready` 헬스체크가 통과할 때까지 대기한 뒤 `migrate`를 자동 실행한다.
- `down`: 컨테이너를 중지한다(볼륨은 보존 — 데이터 유지).
- `reset`: 이 도구가 만든 컨테이너/볼륨(compose 프로젝트 이름 또는 라벨로 식별)만 대상으로 볼륨을 삭제하고 `up`을 재실행한다. 임의의 다른 이름 추정으로 볼륨을 지우지 않는다.
- `migrate`: 원장 테이블을 확인해 미적용 이식 가능 마이그레이션만 순서대로(파일명 오름차순 = 타임스탬프 순) 적용한다. 이미 최신이면 아무 것도 하지 않고 종료 코드 0.
- `status`: 컨테이너 상태와 적용된 마이그레이션 목록을 출력한다.

`docker-compose.local.yml`은 운영 자격 증명을 절대 재사용하지 않는다. `backend/.env`(운영 또는 개인 비밀번호 포함 가능)를 읽거나 그 값을 컨테이너에 주입하지 않고, 로컬 전용 더미 자격 증명(예: `postgres`/`postgres`)을 compose 파일 자체 또는 새 `.env.example` 파생 파일에 고정한다. 포트는 기본 `5432`를 쓰되 로컬에 이미 PostgreSQL이 떠 있을 수 있으므로 `POSTGRES_PORT` 환경 변수로 재정의 가능하게 하고, `scripts/dev.sh`가 이미 쓰는 `lsof` 기반 포트 충돌 검사 패턴을 재사용해 기동 전 점유 여부를 확인한다.

### 개발자 워크플로

```bash
scripts/db-local.sh up
# backend/.env 의 DATABASE_URL 을 postgresql://postgres:postgres@localhost:5432/gamja_market 로 맞춘다
scripts/dev.sh backend start
```

`backend/.env`가 이미 호스티드 Supabase를 가리키는 값(현재 이 워크스페이스 상태)이라면, 도구는 이를 자동으로 덮어쓰지 않는다 — `DATABASE_URL`을 로컬 값으로 바꾸는 것은 개발자가 수동으로 해야 하는 1회성 전환이며, 이를 "위험" 절에서 별도로 명시한다.

## 환경 변수 우선순위

로컬 Docker PostgreSQL과 호스티드 Supabase 사이의 전환은 전적으로 `DATABASE_URL` 값 하나로 이루어지며, 이 값이 어디서 오는지는 백엔드 실행 경로에 따라 달라진다. 백엔드 앱 코드에는 `python-dotenv` 등 자체 `.env` 로더가 없다(`os.getenv`만 사용, `backend/app/repositories/users.py:172` 등) — `.env` 파일을 읽는 주체는 오직 `scripts/dev.sh`뿐이다.

1. **`scripts/dev.sh backend start` / `scripts/dev.sh all start` 경유 실행**: `load_backend_env()`(`scripts/dev.sh:102-113`)가 `set -a` 상태에서 `backend/.env`(또는 `DEV_BACKEND_ENV_FILE`로 재정의된 경로)를 `source`한 뒤 `uv run uvicorn ...`을 실행한다. `source`는 파일의 대입을 무조건 실행하므로, **`backend/.env`에 적힌 값이 그 시점에 이미 내보내져 있던 동일 이름의 셸 환경 변수를 덮어쓴다.** 즉 우선순위는 "`backend/.env`(있으면) > 사전에 export된 셸 값"이며, 파일에 없는 변수만 기존 셸 값이 그대로 유지된다.
2. **`uv run uvicorn ...` / `uv run pytest` 등 `scripts/dev.sh`를 거치지 않는 직접 실행**: `backend/.env`는 전혀 읽히지 않는다. 오직 명령을 실행하는 셸의 현재 환경 변수만 프로세스에 전달된다. `tests/test_requests.py:273`의 `@pytest.mark.skipif(not os.getenv("DATABASE_URL"), ...)`처럼 PostgreSQL 연동 테스트를 돌리려면 개발자가 `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gamja_market uv run pytest`처럼 **셸에서 직접 export하거나 인라인으로 지정**해야 한다. `scripts/db-local.sh`(제안)도 마찬가지로 `.env` 파일을 대신 읽어주지 않으므로, "수용 기준" 7번의 `uv run pytest` 실행 전에 이 값을 개발자(또는 CI 스크립트)가 셸 레벨에서 명시적으로 설정해야 함을 문서화한다.
3. **테스트 격리 훅**: `DEV_BACKEND_ENV_FILE`은 `scripts/dev.sh`가 읽는 파일 경로를 오버라이드하는 기존 계약(`docs/specs/06-backend-env-file-support-design.md`)이며 일반 개발 설정이 아니다. 신설되는 `scripts/db-local.sh`와 `tests/db-local.test.sh`는 이 관례를 재사용해 `DEV_BACKEND_ENV_FILE`(또는 이에 상응하는 db-local 전용 변수)로 실제 `backend/.env`를 건드리지 않고 격리된 fixture를 대상으로 동작을 검증해야 한다.
4. **`backend/.env`가 없을 때**: `load_backend_env()`는 조용히 아무 것도 하지 않고 반환한다(`[[ -f "$env_file" ]] || return 0`). 이 경우 `scripts/dev.sh` 경유 실행도 직접 실행과 동일하게 순수 셸 환경만 사용한다.
5. **Vercel/운영 배포와의 관계**: `APP_ENV`와 `VERCEL`(플랫폼이 자동 주입)은 `backend/app/core/config.py:47`의 `production` 판정(쿠키 `Secure` 강제 등)에만 관여하며 `DATABASE_URL` 선택에는 관여하지 않는다 — Vercel에 배포된 백엔드는 Vercel 대시보드에 설정된 환경 변수를 쓰고, `backend/.env` 파일은 그 배포 경로에 전혀 개입하지 않는다. `scripts/pull-env.sh`(`docs/specs/07`)는 같은 Git 공용 디렉터리의 primary checkout에서 `backend/.env`/`frontend/.env.local`을 현재 worktree로 복사할 뿐이며 Vercel CLI를 호출하지 않으므로, 이 파일 동기화 경로와 Vercel 배포 환경 변수 경로는 서로 독립적이다.
6. **자동 환경 판별 없음**: 위 어떤 경로에도 "호스트명을 보고 로컬/운영을 자동 구분"하는 로직이 없다. `DATABASE_URL`이 로컬 컨테이너를 가리키는지 호스티드 Supabase를 가리키는지는 오직 그 문자열의 현재 값으로만 결정되며, 이는 "위험 및 한계"에서 다룬 수동 전환 위험의 근거이기도 하다.

## 수용 기준 (테스트 가능)

1. `docker compose -f docker-compose.local.yml config --quiet`가 종료 코드 0을 반환한다(compose 파일 문법 유효성).
2. `scripts/db-local.sh up` 실행 후 30초 이내에 컨테이너 헬스체크(`pg_isready`)가 healthy를 보고한다.
3. 초기화 후 `SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')`가 2행을 반환한다.
4. `scripts/db-local.sh migrate`를 빈 DB에 실행하면 이식 가능 9개 파일이 파일명 순으로 적용되고, 원장 테이블의 행 수가 9와 일치하며, `app_users, auth_sessions, purchase_requests, request_applications, chat_threads, chat_messages, request_images, application_images` 8개 테이블이 모두 존재한다. `profiles` 테이블과 `storage` 스키마는 존재하지 않는다(제외가 실제로 적용됐는지 검증).
5. 같은 DB에 `migrate`를 다시 실행하면 오류 없이 종료 코드 0을 반환하고 원장 행 수가 그대로다(멱등성).
6. `scripts/db-local.sh reset` 이후 4번 기준을 다시 만족한다(재현 가능한 초기화).
7. `DATABASE_URL`을 로컬 컨테이너로 설정하고 `uv run pytest`의 PostgreSQL 연동 테스트(예: `app_users`/`purchase_requests` 생성-조회 왕복)를 실행하면 통과하며, 실행 중 호스티드 Supabase 프로젝트(`db.ksnwcdiktoqulrujodof.supabase.co`)로는 어떤 연결도 발생하지 않는다.
8. `DATABASE_URL`을 설정하지 않은 기존 인메모리 리포지토리 테스트 스위트는 이번 변경과 무관하게 그대로 통과한다(회귀 없음).
9. `tests/db-local.test.sh`(신설)가 `bash -n scripts/db-local.sh` 문법 검사, 알 수 없는 서브커맨드에 대한 0이 아닌 종료 코드와 명확한 오류 메시지, 그리고 표준출력/로그에 자격 증명(`DATABASE_URL`, 비밀번호)이 노출되지 않음을 검증한다.
10. 신규 마이그레이션 파일이 매니페스트에 없고 `auth.`/`storage.` 등 Supabase 전용 참조를 포함하면 `migrate`가 실패하고, 참조가 없으면 자동으로 이식 가능 목록에 포함되어 통과한다(제외 목록 fail-closed 동작 검증).
11. `backend/.env`에 로컬 컨테이너용 `DATABASE_URL`을 적어두고, 이와 다른 값을 셸에 미리 `export`한 상태에서 `scripts/dev.sh backend start`를 실행하면 기동된 프로세스는 `backend/.env`의 값을 사용한다(파일이 셸 값을 덮어씀을 검증). 반대로 `scripts/dev.sh`를 거치지 않고 `uv run pytest`를 직접 실행하면 `backend/.env`는 무시되고 셸에 `export`된 값만 적용된다(직접 실행 시 `.env` 미반영을 검증).

## 위험 및 한계

- **부분 스키마로 인한 검증 공백**: `profiles`/`auth.users` 트리거와 `storage.buckets`가 로컬에 없으므로, 회원가입·이메일 인증·이미지 스토리지 업로드/서명 URL 경로는 로컬 DB만으로 끝까지 검증되지 않는다. 이 경로를 건드리는 변경은 계속 호스티드 Supabase 프로젝트(또는 향후 도입할 `supabase start` 전체 스택)로 확인해야 한다.
- **조용한 의미 드리프트**: 새 마이그레이션이 순정 PostgreSQL에서 문법적으로는 통과하지만 Supabase 전용 동작(예: `auth.jwt()`가 반환하는 커스텀 클레임)에 의존한다면, 매니페스트 패턴 검사망을 빠져나가 로컬에서는 성공하고 운영에서는 다르게 동작할 수 있다. 리뷰 체크리스트에 "새 마이그레이션이 Supabase 전용 스키마/함수를 참조하는가"를 명시적 확인 항목으로 추가하는 후속 조치를 권고한다.
- **PostgreSQL 마이너 버전/확장 차이**: 메이저 버전만 17로 맞추며, Supabase가 얹는 `pgsodium`, `supautils` 등 벤더 확장이나 패치 버전(`17.6.1.155`)까지는 재현하지 않는다. 현재 이식 가능 마이그레이션은 이런 확장에 의존하지 않아 위험은 낮지만, 향후 마이그레이션이 확장을 쓰기 시작하면 재평가가 필요하다.
- **기존에 이미 존재하던 위험의 노출**: 이 워크스페이스의 실제 `backend/.env`가 현재 호스티드 프로젝트를 직접 가리키고 있다는 사실 자체가 이번 조사로 드러난 기존 위험이다. 로컬 DB 도구를 추가해도 개발자가 `backend/.env`의 `DATABASE_URL`을 로컬 값으로 수동 전환하기 전까지는 계속 운영 DB에 쓰게 된다. 도구만으로는 강제할 수 없으므로 `backend/README.md` 갱신 등 문서적 안내가 후속 구현 과제에 포함되어야 한다.
- **파괴적 명령의 안전장치**: `reset`은 로컬 데이터를 삭제한다. `scripts/dev.sh`가 이미 지키는 "이 도구가 만들지 않은 프로세스/자원은 절대 건드리지 않는다"는 안전 기준과 동일하게, compose 프로젝트 이름이나 라벨로 대상 컨테이너/볼륨을 한정해 다른 이름 추정으로 삭제하지 않아야 한다.
- **새 로컬 전제조건**: Docker(또는 Colima 등 호환 런타임) 설치가 새로 필요하다. 현재 README/AGENTS.md에는 언급이 없으므로 후속 구현 시 루트 `README.md`와 `backend/README.md`에 전제조건과 명령어를 추가해야 한다. CI 파이프라인은 저장소에 존재하지 않아(`*.yml`/`*.yaml` 워크플로 없음) 이번 설계는 로컬 개발 스코프로 한정하며 CI 통합은 다루지 않는다.

## 스코프 밖 (후속 과제)

- `supabase start`(Supabase CLI) 기반 GoTrue+Storage+Kong 전체 스택 로컬화 — Auth/Storage 경로까지 완전히 로컬에서 검증하려면 필요하지만 이번 설계의 스코프가 아니다.
- 새 마이그레이션 매니페스트 자동 검증을 pre-commit 훅이나 CI로 강제하는 것.
- `backend/.env`가 호스티드 값일 때 백엔드 시작을 경고하거나 차단하는 안전장치(예: 알려진 운영 호스트명 패턴 감지).
