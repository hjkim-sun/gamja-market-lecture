# 감자마켓 프론트엔드

Next.js App Router와 TypeScript로 구성된 감자마켓 웹 애플리케이션입니다.

## 실행

```bash
npm install
npm run dev
```

기본 개발 주소는 <http://localhost:3000>입니다. 브라우저의 `/api/auth/*` 요청은
`BACKEND_API_URL`의 FastAPI로 전달되며, 기본값은 <http://localhost:8000>입니다.

## 명령어

```bash
npm run lint
npm test
npm run build
```

## 런타임 로그

서버에서 처리되지 않은 오류는 JSONL 구조화 로그로 남깁니다. 로컬 개발은 기본적으로
`frontend/logs` 파일 sink를 사용하며, `.env.local`에서 `APP_LOG_DESTINATION` (`file` 또는
`stdout`), `APP_LOG_DIR`, `APP_ENV`를 설정할 수 있습니다. 지속 볼륨이 있는 self-hosted
production에서는 파일 sink를 명시적으로 선택하고 운영 볼륨 경로를 `APP_LOG_DIR`로 지정하세요.

Vercel에서는 `VERCEL=1`일 때 설정과 관계없이 stdout만 사용하며 로그 디렉터리나 `/tmp`에
파일을 만들지 않습니다. Vercel의 함수 로그에서 JSONL 레코드를 조회하세요.

## 소스 구조

- `src/app`: 페이지, 레이아웃, Route Handler
- `src/components`: 여러 기능에서 공유하는 UI
- `src/features`: 인증·구매요청 등 도메인별 코드
- `src/lib`: Supabase 등 외부 서비스 연결
- `src/types`: 공용 TypeScript 타입
- `tests`: 앱과 기능 단위 테스트
