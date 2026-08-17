# 감자마켓

구매자가 원하는 물건과 가격을 먼저 등록하고 판매자가 제안하는 구매자 중심 중고거래 서비스입니다.

## 프로젝트 구조

```text
frontend/  Next.js + TypeScript
backend/   FastAPI + Supabase PostgreSQL
docs/      기획, 설계, 과거 문서와 디자인 산출물
```

## 로컬 실행

프론트엔드:

```bash
cd frontend
npm install
npm run dev
```

백엔드:

```bash
cd backend
uv sync --extra dev
uv run python -m app.server --reload
```

기본 포트는 `8000`이며, 다른 포트는 `uv run python -m app.server --reload --port 8001`처럼 지정합니다. 로컬 요청은 `backend/logs/access.log`, 서버 시작·포트 충돌 등의 오류는 `backend/logs/error.log`에서 확인합니다. `uvicorn app.main:app --reload` 직접 실행은 이 안전한 logging 설정을 적용하지 않으므로 지원하지 않습니다.

검증 명령은 각 디렉터리의 README를 참고합니다.

### 개발 서비스 제어

루트에서 두 서비스를 함께 관리하려면 다음 명령을 사용합니다.

```bash
scripts/dev.sh <backend|frontend|all> <start|stop|restart>
```

상태 파일과 리디렉션된 출력은 추적하지 않는 `.runtime/dev/`에 저장됩니다. 서비스는 `nohup`과 `python3`의 새 세션으로 분리되어 명령을 실행한 터미널을 닫아도 계속 실행되며, 시작 전 포트 `8000`(backend)과 `3000`(frontend)의 다른 점유자를 확인해 점유자를 종료하지 않고 시작을 거부합니다.

### 로컬 PostgreSQL

Docker가 준비되어 있으면 호스티드 Supabase와 분리된 PostgreSQL 17 데이터베이스를 시작할 수 있습니다.

```bash
scripts/db-local.sh up
```

기본 연결은 `postgresql://postgres:postgres@localhost:5432/gamja_market`입니다. `backend/.env`의 `DATABASE_URL`을 이 값으로 **수동으로** 설정한 뒤 백엔드를 시작하세요. 이 도구는 `backend/.env`를 읽거나 변경하지 않으므로, Vercel 및 기존 Supabase 환경 변수에는 영향을 주지 않습니다. `POSTGRES_PORT=55432 scripts/db-local.sh up`처럼 포트를 바꿀 수 있습니다.

`down`은 이 Compose 프로젝트의 컨테이너만 멈추고 데이터를 보존합니다. `reset`은 같은 Compose 프로젝트의 볼륨만 삭제한 뒤 빈 데이터베이스와 이식 가능한 마이그레이션을 다시 만들며, `migrate`는 아직 적용되지 않은 마이그레이션만 적용하고 `status`는 상태와 적용 이력을 표시합니다.

### Vercel 환경 변수 동기화

각 Git worktree는 primary checkout에 이미 준비된 환경 파일을 다음 명령으로 복사해 사용합니다.

```bash
scripts/pull-env.sh
```

스크립트는 Git worktree 메타데이터에서 primary checkout을 찾아 `backend/.env`와 `frontend/.env.local`을 복사합니다. Vercel CLI·로그인·네트워크 연결은 사용하지 않으며, primary checkout에 두 파일이 모두 있어야 합니다. 두 원본을 모두 확인하고 임시 파일에 완전히 복사한 뒤 대상 파일을 교체하므로 원본을 찾지 못하거나 원본 파일이 없으면 현재 worktree의 파일은 변경하지 않습니다.
