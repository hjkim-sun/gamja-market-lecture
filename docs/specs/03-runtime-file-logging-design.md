# 03. FastAPI·Next.js 런타임 파일 로깅 설계

## 1. 목적과 현재 기준

개발 또는 지속 가능한 파일시스템을 가진 self-hosted 환경에서는 백엔드와 프런트엔드의 서버 로그를 짧게 보관하고, Vercel 같은 serverless 환경에서는 같은 구조화 로그를 표준 출력으로 보낸다. 브라우저 로그, 요청 본문, 인증 정보는 수집하지 않는다.

현재 `backend/app/main.py`에는 애플리케이션 로그 설정이나 요청 로그 middleware가 없고, `frontend/next.config.ts`는 `/api/auth/signup` rewrite만 제공한다. Vercel 설정 파일은 없으므로, 파일 기록 가능 여부는 배포처가 아니라 런타임 환경변수와 쓰기 가능 여부로 결정한다.

## 2. 범위와 결정

- 로그 형식은 외부 의존성 없이 한 줄에 한 JSON 객체를 쓰는 JSONL로 통일한다.
- 기본 sink는 `APP_LOG_DESTINATION=auto`이다. `development`이면서 지속 가능한 로컬 파일시스템이면 `file`, 그 밖의 경우에는 `stdout`이다.
- `APP_LOG_DESTINATION`은 `stdout` 또는 `file`로 명시할 수 있다. 단, `VERCEL=1` 또는 serverless 실행이 감지되면 `file` 요청도 경고 한 줄 후 `stdout`으로 강제 전환한다.
- `APP_LOG_LEVEL` 기본값은 `INFO`, `APP_LOG_RETENTION_DAYS` 기본값은 `7`이다. 잘못된 값은 애플리케이션을 중단시키지 않고 안전한 기본값을 쓴다.
- 파일 sink 초기화·쓰기·회전에 실패해도 요청을 실패시키지 않는다. 한 번의 안전한 `log_sink_unavailable` 구조화 stdout 경고 후 stdout sink로 폴백한다.

## 3. 디렉터리와 파일 보관 정책

| 서비스 | 기본 `APP_LOG_DIR` | 파일 이름 | 보관/상한 |
| --- | --- | --- | --- |
| FastAPI | `backend/logs` | `gamja-backend-YYYY-MM-DD-<pid>.jsonl` | 날짜별 파일, 프로세스별 최대 10 MiB, `.1`~`.4` 회전, 7일 초과 파일 삭제 |
| Next.js 서버 | `frontend/logs` | `gamja-frontend-YYYY-MM-DD-<pid>.jsonl` | 날짜별 파일, 프로세스별 최대 10 MiB, `.1`~`.4` 회전, 7일 초과 파일 삭제 |

디렉터리는 **file sink가 실제로 선택된 프로세스 시작 시에만** `mkdir -p`로 생성한다. 구현 시 빈 디렉터리 의도를 보이기 위해 `backend/logs/.gitkeep`과 `frontend/logs/.gitkeep`을 추가하고, 루트 `.gitignore`에는 다음처럼 해당 디렉터리의 생성 로그만 무시한다. 프로젝트 전체의 `*.log`를 무시하지 않는다.

```gitignore
# Runtime JSONL logs (directory placeholders remain tracked)
backend/logs/*
!backend/logs/.gitkeep
frontend/logs/*
!frontend/logs/.gitkeep
```

`APP_LOG_DIR`은 절대 경로 또는 각 서비스 작업 디렉터리 기준 상대 경로만 허용한다. 비어 있거나 디렉터리가 아닌 경로, 저장소 밖으로 나가는 상대 경로는 `file` sink를 포기하고 stdout으로 폴백한다.

## 4. 공통 로그 레코드와 비밀정보 처리

모든 레코드는 아래의 공통 필드를 갖는다. 값이 없는 선택 필드는 생략한다.

```json
{
  "timestamp": "2026-08-16T12:34:56.789Z",
  "level": "INFO",
  "service": "gamja-backend",
  "environment": "development",
  "event": "http_request",
  "message": "request completed",
  "request_id": "uuid",
  "method": "POST",
  "route": "/api/auth/signup",
  "status_code": 201,
  "duration_ms": 14
}
```

- `timestamp`는 UTC ISO-8601, `level`은 `DEBUG`/`INFO`/`WARNING`/`ERROR` 중 하나, `service`는 각각 `gamja-backend`/`gamja-frontend`로 고정한다.
- HTTP 이벤트에는 내부에서 생성한 UUID `request_id`, HTTP method, **query string을 제거한 route**, status와 duration만 기록한다. 응답에는 같은 `X-Request-ID`를 반환한다.
- 오류 이벤트에는 `error_type`과 내부용 분류 `error_code`만 추가한다. 예상하지 못한 예외의 원문 message·repr·stack trace는 기록하지 않고 `message: "unhandled server error"`로 고정한다. 애플리케이션이 이미 정의한 공개 오류 코드만 기록할 수 있다.
- request/response body, 모든 header, query string, cookie/`Set-Cookie`, `Authorization`, 비밀번호·해시, 세션/CSRF/JWT/API token, API key, Supabase key, `DATABASE_URL`, 원본 이메일과 IP 주소는 기록 금지다. 재사용 가능한 redaction 함수는 키 이름에 `password`, `secret`, `token`, `authorization`, `cookie`, `key`, `database_url`, `email`이 포함되면 값 전체를 `[REDACTED]`로 바꾸며, URL은 pathname만 남긴다.
- 사용자 입력을 interpolation한 자유 형식 message를 금지한다. 개발 오류 상세가 필요하면 request ID로 로컬 재현하며, 이 기본 logger의 금지 목록을 완화하지 않는다.

## 5. 서비스별 최소 구현

### FastAPI

1. `backend/app/core/logging.py`를 추가한다. 표준 `logging`과 JSON formatter/파일 handler만 사용해 sink 선택, 디렉터리 생성, 보관 정리, 회전, redaction, stdout 폴백을 제공한다.
2. `backend/app/main.py`에 lifespan 초기화와 단일 HTTP logging middleware를 추가한다. middleware는 시작 시 request ID를 생성하고 종료 시 위 형식의 `http_request`를 한 번 기록한다. 처리되지 않은 예외는 공개되지 않은 `error_type`/`error_code`만 가진 `ERROR` 이벤트로 기록한 뒤 기존 FastAPI 오류 처리를 유지한다.
3. middleware가 완전한 구조화 access 로그의 권위가 된다. `uvicorn`의 중복 plaintext access log는 로컬 실행 명령에서 `--no-access-log`로 끈다. `uvicorn` 자체의 시작/프로세스 진단 stdout은 플랫폼 로그로 남겨 둔다.
4. `backend/README.md`와 `backend/.env.example`(신규)에 `APP_LOG_*` 예시 및 `--no-access-log` 실행 명령을 문서화한다. 테스트는 `APP_LOG_DESTINATION=stdout` 또는 임시 `APP_LOG_DIR`을 명시해 저장소에 실제 로그를 남기지 않는다.

### Next.js

1. `frontend/src/lib/logging/server.ts`를 추가한다. 파일 최상단에서 `server-only`를 선언하고 Node `fs/promises`만 사용한다. 같은 sink 선택·JSONL·회전·보관·redaction 계약을 구현하되, 서버 모듈에서만 import할 수 있다.
2. `frontend/src/instrumentation.ts`를 추가한다. `register()`는 파일 sink를 초기화하고, Next 16의 `onRequestError`는 처리되지 않은 서버 오류를 `ERROR` 이벤트로 기록한다. 이 hook은 Next가 전달한 pathname만 사용하고 query/header/body/error 원문은 전달하지 않는다.
3. `frontend/src/features/auth/actions/auth.ts`처럼 이미 존재하는 server action/route handler는 외부 호출의 예상 밖 실패를 사용자 입력 없이 `logServerError`에 전달한 뒤 현재의 사용자용 오류 계약을 유지한다. 정상적인 4xx 검증·중복 이메일은 오류 로그가 아니라 필요 시 안전한 `INFO`/`WARNING` 이벤트만 남긴다.
4. `frontend/src/proxy.ts`, Client Component, 브라우저 코드에는 파일 logger를 import하지 않는다. Proxy는 배포 시 Edge/CDN 실행일 수 있고, 브라우저는 파일시스템에 쓸 수 없기 때문이다. 전역 frontend access logging은 이번 범위에서 제외하며, server error 및 명시적으로 추가한 server-side 업무 이벤트만 남긴다.
5. `frontend/.env.example`, `frontend/README.md`(없으면 루트 `README.md`)에 `APP_LOG_*`과 Vercel 제약을 문서화한다. `frontend/next.config.ts`의 API rewrite 계약은 변경하지 않는다.

## 6. 개발·self-hosted·Vercel 동작

| 실행 환경 | sink | 디렉터리 처리 | 운영 원칙 |
| --- | --- | --- | --- |
| 로컬 개발 (`uvicorn --reload`, `next dev`) | 기본 file | 위 기본 로그 디렉터리를 필요 시 생성 | 개발자가 JSONL을 확인하되 Git에는 올리지 않는다. |
| 지속 볼륨이 있는 self-hosted production | 기본 stdout, `APP_LOG_DESTINATION=file`을 명시한 경우 file | 운영 볼륨에 `APP_LOG_DIR` 지정 | 파일 보관은 7일/10 MiB×5로 제한하고, 중앙 수집 전환 전의 보조 진단 수단으로 쓴다. |
| Vercel/serverless (`VERCEL=1`) | stdout 강제 | `frontend/logs`, `backend/logs`, `/tmp`에 파일을 쓰지 않는다 | Vercel 함수 인스턴스의 로컬 파일은 임시·인스턴스별이므로 영속 로그로 사용하지 않는다. Vercel가 수집하는 stdout JSONL을 조회한다. |

Vercel 함수가 병렬 실행·재시작될 수 있으므로 파일 순서나 한 파일의 존재를 감사 근거로 삼지 않는다. 장기 보존, 검색, 경보가 필요해지는 시점에는 이 이벤트 스키마를 그대로 외부 로그 수집기로 보내는 작업을 별도 승인 범위로 만든다.

## 7. 정확한 변경 대상

| 구분 | 파일 | 변경 |
| --- | --- | --- |
| Git 정책 | `.gitignore`, `backend/logs/.gitkeep`, `frontend/logs/.gitkeep` | 두 runtime 로그 디렉터리만 무시하고 placeholder는 추적 |
| Backend | `backend/app/core/logging.py` | JSONL formatter, safe record builder, file/stdout sink와 retention/rotation |
| Backend | `backend/app/main.py` | lifespan, request ID, 구조화 access/error middleware |
| Backend 문서 | `backend/.env.example`, `backend/README.md` | 안전한 환경변수와 `uvicorn --no-access-log` 실행 예시 |
| Frontend | `frontend/src/lib/logging/server.ts` | server-only JSONL/stdout logger |
| Frontend | `frontend/src/instrumentation.ts` | startup init 및 `onRequestError` 연결 |
| Frontend | `frontend/src/features/auth/actions/auth.ts` | 예상 밖 server-action 실패의 안전한 로그 호출 |
| Frontend 문서 | `frontend/.env.example`, `README.md` | 환경변수·Vercel stdout 정책 |
| 테스트(별도 RED 작업) | `backend/tests/test_logging.py`, `frontend/tests/lib/logging/server.test.ts`, `frontend/tests/instrumentation.test.ts` | 아래 수용 기준을 먼저 검증 |

## 8. 구현 순서와 수용 기준

1. tester는 파일을 쓰는 모든 테스트에 임시 디렉터리를 주입하는 RED 테스트를 먼저 추가한다. backend와 frontend logger가 한 줄 JSON을 만들고 필수 필드·UTC timestamp·service 이름을 포함하는지 검증한다.
2. backend logger와 middleware를 구현한다. `POST /api/auth/signup`의 성공/400/500(테스트 전용 예외) 각각이 query/body 없이 status·duration·request ID를 남기고, 응답 `X-Request-ID`와 일치하는지 검증한다.
3. frontend server logger와 instrumentation/server-action 연결을 구현한다. `next build`, Vitest, Pytest가 통과하고 Client Component에서 Node `fs` 또는 server logger를 번들에 포함하지 않는지 확인한다.
4. Vercel 환경을 흉내 낸 테스트에서 `VERCEL=1`과 `APP_LOG_DESTINATION=file`을 설정해도 로그 디렉터리나 `/tmp` 파일이 생성되지 않고 구조화 stdout sink가 선택되는지 검증한다.
5. redaction table-driven 테스트에서 password, hash, cookie, authorization, token, API key, DB URL, 원본 email, query string이 어느 JSONL 레코드에도 나타나지 않음을 검증한다. 파일 sink 실패 및 10 MiB 회전/7일 prune도 요청 성공을 방해하지 않는지 확인한다.

완료 조건은 (a) 두 서비스가 같은 안전한 JSONL 계약을 쓰고, (b) 로컬 개발에서는 추적되지 않는 파일을 남기며, (c) Vercel/serverless에서는 파일을 전혀 의존하지 않고 stdout으로 남기고, (d) 인증 비밀이나 사용자 입력이 로그에 남지 않는 것이다.
