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

### Vercel 환경 변수 동기화

Vercel CLI 로그인 및 프로젝트 link를 마친 뒤, 로컬 development 변수는 루트에서 다음 명령으로 두 서비스에 동기화합니다.

```bash
scripts/pull-vercel-env.sh
```

필요하면 `scripts/pull-vercel-env.sh --environment preview` 또는 `-e=production`처럼 환경을 지정할 수 있습니다. Vercel CLI가 없다면 `npm install --global vercel`로 설치합니다.
