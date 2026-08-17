# 06. Backend environment-file support design

## 목적

로컬 개발 서비스 컨트롤러가 백엔드 시작 시 `DATABASE_URL` 같은 민감한 설정을 안전하게 전달하도록 한다. 저장소에는 형식만 담은 `backend/.env.example`를 유지하고, 실제 값이 들어갈 `backend/.env`는 추적하지 않는다.

## 동작

`scripts/dev.sh backend start`와 `scripts/dev.sh all start`는 백엔드 명령을 실행하기 직전에 `backend/.env`를 읽는다. 파일이 없으면 기존처럼 현재 환경만으로 시작하며, 파일 내용이나 개별 환경 변수는 표준 출력과 서비스 컨트롤러 로그에 표시하지 않는다.

테스트 격리를 위해서만 `DEV_BACKEND_ENV_FILE`을 설정하면 기본 `backend/.env` 대신 해당 경로를 읽는다. 이 값은 일반 개발 설정이 아니며, 테스트가 임시 fixture를 사용하도록 하는 계약 훅이다.

## 구성 및 검증

`backend/.env`에는 로컬용 `DATABASE_URL` 자리표시자를 두고 `.gitignore`에서 `/backend/.env`를 명시적으로 제외한다. `.env.example`에는 복사 가능한 동일 형식과 비밀 정보를 저장소에 넣지 않는 안내를 둔다.

`tests/dev-service.test.sh`는 override 파일의 `DATABASE_URL`이 실제 `uv` 프로세스까지 전달되는지 확인한다. 구현 뒤에는 해당 계약 테스트와 `bash -n scripts/dev.sh`를 실행한다.
