# 07. Vercel environment sync design

## 목적

primary Git checkout에 준비된 환경 파일을 각 worktree에서 일관되게 사용한다. `scripts/pull-vercel-env.sh`는 primary checkout의 `backend/.env`와 `frontend/.env.local`을 현재 checkout으로 복사하며, 두 파일은 실제 비밀 값이므로 Git에 추가하지 않는다.

## 인터페이스

```bash
scripts/pull-vercel-env.sh
```

인수는 받지 않는다. `--help`는 사용법을 출력하고, 그 밖의 인수는 종료 코드 `64`로 거부한다.

## 실행과 안전성

스크립트는 호출 위치와 무관하게 자신의 위치에서 현재 checkout의 저장소 루트를 계산한다. 이어서 `git worktree list --porcelain`으로 같은 Git 공용 디렉터리에 연결된 primary checkout을 동적으로 찾고, 그 checkout의 두 환경 파일을 원본으로 사용한다. 경로를 하드코딩하지 않고 Vercel CLI·인증·네트워크를 호출하지 않는다.

Git worktree 또는 primary checkout을 찾지 못하면 명확한 오류를 내고 종료한다. primary checkout의 `backend/.env` 또는 `frontend/.env.local` 중 하나라도 없거나 읽을 수 없으면 대상 파일을 변경하지 않고 종료한다. 환경 파일의 내용은 터미널에 전달하지 않아 비밀 값이 로그에 노출되지 않는다.

두 원본을 먼저 모두 검증하고, 대상 파일과 같은 디렉터리에 임시 파일로 완전히 복사한다. 두 임시 파일의 복사가 성공한 뒤에만 `mv`로 각 대상 파일을 교체하므로 각 파일은 이전 완전한 내용 또는 새 완전한 내용만 갖는다. 원본 탐색·검증·복사 단계에서 실패하면 현재 대상 파일은 유지되고 임시 파일은 정리된다.

## 검증

`tests/vercel-env-sync.test.sh`는 임시 Git 저장소와 linked worktree로 primary checkout 복사, Vercel CLI 미호출, 비밀 값 미출력을 검증한다. 구현 변경 후 `bash -n scripts/pull-vercel-env.sh`와 해당 계약 테스트를 실행한다.
