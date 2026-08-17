# 감자마켓 백엔드

FastAPI 애플리케이션과 Supabase PostgreSQL 마이그레이션을 관리합니다.

## 실행

```bash
uv sync --extra dev
cp .env.example .env  # 최초 1회, 실제 로컬 비밀번호로 수정
cd ..
scripts/dev.sh backend start
```

`scripts/dev.sh backend start`는 백엔드를 시작하기 전에 `backend/.env`를 읽어 해당 프로세스에만 환경 변수를 전달합니다. `DATABASE_URL`은 PostgreSQL에 데이터를 영속화하려면 필요하며, `.env`에는 실제 비밀번호나 운영 자격 증명을 저장소에 넣지 마세요. 로컬 파일은 Git에서 명시적으로 제외되고, 공유할 설정 형식은 `.env.example`에만 유지합니다.

서비스를 중지하거나 다시 시작하려면 각각 `scripts/dev.sh backend stop`, `scripts/dev.sh backend restart`를 사용합니다. 자동화 계약 테스트에서만 별도 fixture를 쓰기 위해 `DEV_BACKEND_ENV_FILE`로 읽을 파일을 바꿀 수 있으며, 일반 개발 환경에서는 설정하지 않습니다.

다른 포트가 필요하면 `--port`를 붙입니다. 예를 들어 `uv run python -m app.server --reload --port 8001`처럼 실행합니다. `uvicorn app.main:app --reload` 직접 실행은 안전한 process logging과 포트 점유 오류 기록을 보장하지 않으므로 지원하지 않습니다.

## 런타임 로깅

백엔드는 외부 의존성 없이 사람이 읽을 수 있는 conventional 로그를 기록합니다. 기본값 `APP_LOG_DESTINATION=auto`는 개발 환경에서만 `backend/logs/access.log`와 `backend/logs/error.log` 파일을 사용하고, 그 밖의 환경에서는 표준 출력/표준 오류로 보냅니다. `APP_LOG_DESTINATION=file`과 쓰기 가능한 `APP_LOG_DIR`을 지정하면 self-hosted 환경의 볼륨에도 기록할 수 있습니다.

```bash
APP_ENV=development
APP_LOG_DESTINATION=auto       # auto | file | stdout
APP_LOG_DIR=logs               # backend/ 기준 상대 경로 또는 절대 경로
APP_LOG_LEVEL=INFO             # DEBUG | INFO | WARNING | ERROR
```

두 파일은 각각 10 MiB에서 표준 회전본 `.1`~`.4`를 만들 수 있습니다. access의 권위는 FastAPI middleware이며 Uvicorn access log는 항상 비활성화됩니다. `error.log`에는 기동·종료·import와 포트 점유 같은 Uvicorn 오류도 기록되므로, 포트 충돌은 이 파일에서 바로 진단할 수 있습니다.

`VERCEL=1` 같은 serverless 환경에서는 file 설정이 있어도 디렉터리나 로그 파일을 만들지 않고 access는 stdout, 오류는 stderr로 기록합니다. 요청 로그는 UUID `X-Request-ID`, method, query를 제거한 route, status, duration만 포함하며 body·header·cookie·토큰·이메일·비밀번호는 기록하지 않습니다.

## 테스트

```bash
uv run pytest
```

DB 스키마 변경은 `supabase/migrations`에 SQL 마이그레이션으로 추가합니다.
