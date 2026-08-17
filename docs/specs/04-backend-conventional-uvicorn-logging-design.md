# 04. Backend conventional access/error 로그와 Uvicorn 시작 오류 설계

## 1. 목적과 현재 기준

이 문서는 `03-runtime-file-logging-design.md`의 **backend 파일명·형식·Uvicorn 부분만** 대체한다. 로컬 개발에서는 날짜·PID JSONL 대신 다음의 사람이 읽을 수 있는 고정 파일을 사용한다.

```text
backend/logs/access.log
backend/logs/error.log
```

현재 `app.core.logging.RuntimeLogger`는 FastAPI lifespan 이후에 `gamja-backend-YYYY-MM-DD-<pid>.jsonl`을 열고, `app.main` middleware가 안전한 요청 이벤트를 기록한다. 반면 Uvicorn은 ASGI 앱 import/lifespan보다 먼저 logging을 설정하고 socket bind를 수행하므로, 점유된 포트 오류는 현재 앱 logger로는 잡을 수 없다. 또한 루트 `README.md`의 `uvicorn app.main:app --reload`은 Uvicorn access log를 켜고, backend README의 `--no-access-log` 명령은 Uvicorn 시작 오류를 파일화하지 않는다.

## 2. 결정

1. access의 권위는 계속 FastAPI middleware다. Uvicorn access logger는 모든 환경에서 `--no-access-log`로 끈다. Uvicorn 기본 access 형식에는 원본 request target(따라서 query)이 들어갈 수 있으므로 `uvicorn.access`를 `access.log`에 연결하지 않는다.
2. `gamja.access`는 `access.log`, `gamja.error`와 `uvicorn`/`uvicorn.error`는 `error.log`를 공유한다. `http_request`는 access 채널로, 처리되지 않은 요청 오류와 서버 lifecycle/bind 오류는 error 채널로 보낸다.
3. 두 파일은 append하는 `RotatingFileHandler`를 사용한다. 기준 파일명은 항상 `access.log`/`error.log`이며, 필요할 때만 표준 회전본 `.1`~`.4`를 만든다(각 10 MiB, backup 4). 날짜·PID 파일 생성과 날짜 기반 prune은 제거한다.
4. 로컬 `backend/logs`는 프로세스 logging 설정을 만들기 전에 `mkdir(parents=True, exist_ok=True)`로 보장한다. `.gitkeep` 및 현행 `.gitignore`의 `backend/logs/*` 예외는 유지하며, 이미 남아 있는 `gamja-backend-*.jsonl`은 이번 변경이 새로 삭제하지 않는다.

## 3. 프로세스 시작 구성과 실행 명령

`backend/app/core/logging.py`에 process-level logging config builder를 둔다. 이 함수는 현재의 `APP_ENV`, `APP_LOG_DESTINATION`, `APP_LOG_DIR`, `APP_LOG_LEVEL` 검증을 재사용하고, 아래 logger/handler를 하나의 `dictConfig`로 만든다.

| logger | local handler | 용도 |
| --- | --- | --- |
| `gamja.access` | `access.log` | middleware의 안전한 완료 요청 1건 |
| `gamja.error` | `error.log` | middleware의 안전한 `http_error` 및 sink 경고 |
| `uvicorn`, `uvicorn.error` | 같은 `error.log` handler | process start, shutdown, import, bind 진단 |
| `uvicorn.access` | handler 없음, propagate false | 중복 및 query 노출 방지 |

새 `backend/app/server.py`는 이 builder를 호출해 디렉터리를 만든 뒤 다음처럼 `uvicorn.run()`에 **dict 자체**를 `log_config`로 넘긴다. `access_log=False`도 함께 강제한다.

```python
uvicorn.run(
    "app.main:app",
    host="127.0.0.1",
    port=8000,
    reload=reload_requested,
    access_log=False,
    log_config=build_process_log_config(),
)
```

로컬 표준 명령은 다음으로 통일한다.

```bash
uv run python -m app.server --reload
```

이 방식에서 Uvicorn은 `Config` 생성 중 config를 적용하고 그 뒤 socket을 bind한다. `--reload` parent와 child 모두 Uvicorn이 같은 dict config를 적용하므로, parent에서 발생하는 `EADDRINUSE`도 `backend/logs/error.log`에 기록된다.

**bare `uvicorn app.main:app --reload`은 요구사항을 만족하도록 지원할 수 없다.** Uvicorn CLI는 app을 import하기 전에 자체 logging/bind를 수행하고, 현재 config에는 자동 발견용 환경변수가 없다. 그 명령을 유지하려면 매번 동등한 `--no-access-log --log-config <파일>`을 붙여야 하며, file/stdout 선택과 디렉터리 준비를 안전하게 보장하려면 별도 static config와 wrapper가 중복된다. 따라서 최소 안전 경로는 위 `app.server` entry point 하나이며, 루트/ backend README 모두 이를 사용한다.

## 4. 안전한 conventional line 형식

JSONL formatter는 conventional text formatter로 바꾸되, raw `LogRecord.getMessage()`, `exc_info`, traceback을 파일에 쓰지 않는다. formatter는 내부에서 만든 고정 필드만 출력한다.

```text
2026-08-16T13:10:22.123Z INFO  access request_id=<uuid> method=POST route=/api/auth/signup status=201 duration_ms=14.2
2026-08-16T13:10:25.110Z ERROR error event=http_error type=RuntimeError code=unhandled_exception status=500
2026-08-16T13:11:00.004Z ERROR uvicorn event=bind_failed reason=address_in_use
```

- `SafeRuntimeFormatter`는 `http_request`에 request ID, method, **pathname only**, status, duration만 사용한다. error event는 고정 event/type/code/status만 쓴다.
- `SafeUvicornFormatter`는 알려진 lifecycle 이벤트와 `OSError`만 분류한다. `errno.EADDRINUSE`는 고정 `event=bind_failed reason=address_in_use`로 기록하고, 다른 Uvicorn record는 raw message, args, URL, exception text, traceback 없이 `event=server_runtime_error` 같은 고정 분류로 기록한다.
- request/response body, header, query/fragment, cookie, Authorization, password/hash, token/key, `DATABASE_URL`, email, IP 및 임의 exception 문자열은 두 파일과 stdout 어느 곳에도 기록하지 않는다. 기존 `pathname_only` 및 safe field allow-list는 유지한다.

`RuntimeLogger`는 더 이상 독자 handler를 close/교체하지 않는 facade로 축소한다. configured `gamja.access`/`gamja.error` logger에 안전한 payload만 전달하며, 일반 `logging` root logger를 파일 handler에 붙이지 않는다. 이는 다른 라이브러리의 임의 메시지가 자격증명을 `error.log`에 쓰는 경로를 만들지 않기 위함이다.

## 5. Vercel과 file sink 실패

`VERCEL=1` 또는 Lambda 감지 시 builder는 디렉터리 생성·파일 handler·rotation을 전혀 하지 않는다. 동일한 safe formatter를 `gamja.access`에는 stdout, `gamja.error`/`uvicorn.error`에는 stderr handler로 연결하고, Vercel은 두 stream을 수집한다. Vercel deployment가 Uvicorn을 직접 실행한다면 반드시 이 entry point를 사용하거나 동등하게 `access_log=False`와 stdout-only process config를 적용한다; 서버리스 adapter가 `app.main:app`만 import하는 경우에도 lifespan의 runtime facade는 stdout-only handler를 보장한다.

file handler 준비/쓰기/회전에 실패하면 요청을 실패시키지 않고 safe runtime logger를 stdout/stderr로 한 번 전환한다. 다만 Uvicorn bind 이전의 파일 준비 실패는 console fallback으로만 관찰 가능하므로, wrapper는 fallback 원인을 안전한 고정 문자열로 stderr에 남긴다. 이 경우에도 query/body/credential을 포함하지 않는다.

## 6. 정확한 변경 대상

| 파일 | 변경 |
| --- | --- |
| `backend/app/core/logging.py` | JSONL/date-PID handler와 prune 제거; safe conventional formatter, `build_process_log_config`, access/error facade, local/stdout handler 선택 추가 |
| `backend/app/server.py` (신규) | env-safe command parsing, process config 선적용, `uvicorn.run(..., access_log=False, log_config=...)` |
| `backend/app/main.py` | `http_request`를 access 채널, `http_error`를 error 채널으로 분리하고 lifespan에서 facade만 초기화 |
| `backend/tests/test_logging.py` | 기존 JSONL assertions를 conventional access/error 및 안전성 assertions로 교체 |
| `backend/tests/test_server_logging.py` (신규) | 실제 subprocess startup/bind logging acceptance tests |
| `backend/README.md`, `README.md`, `backend/.env.example` | 새 local command, 두 파일, Vercel stdout과 bare Uvicorn 비지원 명시 |

`.gitignore`와 `backend/logs/.gitkeep`은 이미 필요한 정책을 만족하므로 변경하지 않는다. frontend와 API/DB 동작은 범위 밖이다.

## 7. RED-first 수용 기준

1. tester는 구현 전 temp `APP_LOG_DIR`를 주입한 RED 테스트를 만든다. `POST /api/auth/signup?tracking=<secret>` 성공 후 `access.log`만 생성되고, 정확히 한 안전한 `request_id/method/route/status/duration` line 및 응답 `X-Request-ID`를 확인한다.
2. 위 두 파일의 원문에 email, password, query value/key, `Authorization`, cookie, token, database URL 또는 body 일부가 없음을 table-driven으로 확인한다. `/path?x=1`은 `/path`만 남는다.
3. 테스트 전용 500은 `error.log`에 고정 event/type/code/status만 남기고 exception message/traceback을 남기지 않으며, `access.log`에는 500 완료 line 하나만 남긴다. Uvicorn access logger가 만든 두 번째 line은 없어야 한다.
4. 사용 중인 TCP port를 점유한 뒤 `uv run python -m app.server --port <occupied>` subprocess를 실행한다. non-zero exit, `error.log`의 `ERROR ... event=bind_failed reason=address_in_use`, `access.log` 미생성 또는 새 access line 없음, 비밀정보 부재를 확인한다. 같은 검증을 `--reload`로도 수행해 parent bind 오류를 검증한다.
5. `VERCEL=1`과 `APP_LOG_DESTINATION=file`으로 process builder를 실행해도 temp log directory와 `access.log`/`error.log`/rotation file이 생성되지 않고, safe access/error lines가 stdout/stderr로만 가는지 확인한다.
6. `uv run pytest`가 통과하고, 문서화한 명령으로 정상 기동·요청·종료을 수동 확인한다. bare Uvicorn 명령은 지원 명령으로 문서화하지 않는다.
