---
name: tdd-development
description: This is a procedural guide for developing software using TDD (Test-Driven Development) with Orca Orchestration.
It describes the orchestration workflow between the Designer Worker, Tester Worker, and Developer Worker.
Load this skill when the user requests new feature development or complex modifications to existing functionality.
---
tdd (테스트 주도 개발)을 위해 orca orchestration 을 사용하며 사용자의 지시사항을 해석하여 아래 패턴 중 하나를 적용한다. 

# 패턴 유형
1. 기본 패턴
설계 문서를 생성해야 하는 경우 또는 설계가 크게 바뀌는 경우 적용하며 단순한 수정 건에는 designer worker, 또는 tester worker는 생략한다.

main orchestrator --> designer worker --> tester worker(RED케이스 생성) ---> backend developer worker
                                                                      ├─> front developer worker

 - designer worker agent: claude
 - tester worker agent: codex
 - backend developer worker agent: codex
 - front developer agent: claude

메인 오케스트레이터는 위 4개의 워커를 생성하며 backend worker와 front worker는 상호 통신할 수 있도록 상호 dispatch_id를 알려준다.

# Must to do
각 터미널의 명칭으로 워커의 이름을 지정해준다. (ex: designer worker: designer)