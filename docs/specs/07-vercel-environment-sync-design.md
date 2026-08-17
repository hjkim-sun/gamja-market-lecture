# 07. Vercel environment sync design

## 목적

연결된 Vercel 프로젝트의 환경 변수를 로컬 백엔드와 프론트엔드에서 일관되게 사용한다. `scripts/pull-vercel-env.sh`는 기본으로 development 변수를 `backend/.env`와 `frontend/.env.local`에 내려받으며, 두 파일은 실제 비밀 값이므로 Git에 추가하지 않는다.

## 인터페이스

```bash
scripts/pull-vercel-env.sh
scripts/pull-vercel-env.sh --environment preview
scripts/pull-vercel-env.sh -e=production
```

지원 환경은 `development`, `preview`, `production`이다. 옵션이 없으면 `development`를 사용하며, `-e`, `--environment`, 그리고 두 옵션의 `=` 형식을 지원한다. `--help`는 사용법을 출력하고, 알 수 없는 옵션·빈 값·지원하지 않는 환경은 종료 코드 `64`로 거부한다.

## 실행과 안전성

스크립트는 호출 위치와 무관하게 자신의 위치에서 저장소 루트를 계산하고 그 위치에서 `vercel env pull`을 실행한다. 따라서 Vercel CLI 인증과 해당 저장소의 Vercel link가 이미 준비되어 있으면 별도 프롬프트 없이 실행할 수 있다.

Vercel CLI가 없으면 `npm install --global vercel` 설치 방법을 포함한 오류를 내고 종료한다. CLI 출력과 내려받은 파일의 내용은 터미널에 전달하지 않아 비밀 값이 로그에 노출되지 않는다.

두 대상 파일을 내려받기 전에 기존 파일은 같은 디렉터리의 임시 백업으로 보관한다. 한 번의 pull이라도 실패하면 성공한 대상까지 모두 원래 상태로 복원하고, 기존에 없던 대상은 제거한다. 두 pull이 모두 성공할 때만 백업을 폐기하므로 실패 시 기존 대상 파일이 유지된다.

## 검증

`tests/vercel-env-sync.test.sh`는 임시 Vercel CLI로 기본 development 동작, preview 선택, 호출 디렉터리 독립성, CLI 누락 오류, 비밀 값 미출력을 검증한다. 구현 변경 후 `bash -n scripts/pull-vercel-env.sh`와 해당 계약 테스트를 실행한다.
