# Orca Orchestration 패턴 조사 결과

> 조사일: 2026-08-12 / 대상: `orca` 1.4.180, `claude` 2.1.228, `codex-cli` 0.147.0
> 이 문서의 "실측" 표시는 모두 실제로 워커를 띄워 명령을 실행하고 받은 출력에 근거합니다. 추측은 `[추정]`으로 따로 표시했습니다.

---

## 0. 3줄 요약

1. **`lecture-concept.md`의 전제 중 하나는 틀렸습니다.** "모든 단계를 메인 세션이 중재한다"는 사실이 아니며, **워커끼리 코디네이터를 거치지 않고 직접 메시지를 주고받을 수 있습니다** (실측). 이게 강의에서 보여줄 수 있는 가장 강력한 한 방입니다.
2. **Claude Code와 Codex의 진짜 차이는 "질문 가능 여부"가 아니라 "세션 내부에서 서브에이전트끼리 협업할 수 있는가"입니다.** **Codex 워커도 코디네이터에게 blocking 질문(`ask`)을 보내고 답을 받아 재개할 수 있습니다**(실측, `run_018eda73019a`). 갈리는 지점은 L2/L3입니다 — Claude 팀모드는 형제 서브에이전트 간 P2P가 되고(실측), Codex 서브에이전트는 형제끼리 통신할 수단이 없습니다(실측).
3. **Orca 자체도 별도 Child Run을 이용한 계층 오케스트레이션이 가능합니다.** 메인 → 서브 오케스트레이터 2개 → 하위 워커 4개의 구조에서 하위 `ask/reply`, 완료 집계, 상향 `worker_done`까지 모두 성공했습니다(실측, `run_87b2e6509f8c`). 단, 한 터미널은 한 번에 한 Run의 coordinator inbox만 소비할 수 있습니다.

> **정정 이력 (2차 통제 실험 반영).** 이 문서의 초판은 "Codex 워커는 `ask`를 못 한다"고 결론냈습니다. **오류입니다.** 근거였던 `run_23fa5106932d`의 `dispatch_capability_invalid` 관측은 **인증 인자가 빠진 bare `ask` 명령**을 실행해서 나온 교란된 결과였습니다. 동일 환경(`orca` 1.4.180 / `codex-cli` 0.147.0)에서 통제 실험(`run_018eda73019a`)을 다시 돌린 결과, **bare 명령은 Claude·Codex 양쪽 모두 exit 1 / `dispatch_capability_invalid`로 실패**하고, **각 live dispatch preamble에 주입된 정식 `ask` 템플릿(= `--from` 값과 dispatch capability 보존)을 쓰면 양쪽 모두 정상 왕복**했습니다. 즉 관측된 것은 *에이전트 종류의 차이*가 아니라 *명령 호출 형태의 차이*였습니다. 아래 본문은 이 정정을 반영한 상태이며, 그 외 독립 실측 결과(#1, #5~#12 등)는 그대로 유지했습니다.

> **추가 실측 (3차 계층 실험 반영).** `run_87b2e6509f8c`에서 Codex·Claude 워커를 각각 서브 오케스트레이터로 배치하고, 각 서브가 별도 Child Run과 하위 워커 2개를 직접 생성·감독하게 했습니다. 여섯 Dispatch가 모두 `completed`, `failure_count:0`으로 정산됐습니다. 따라서 이 문서에서 말하는 "계층 오케스트레이션"은 **한 Run 안의 네이티브 재귀 Task tree가 아니라, 부모 Dispatch capability를 유지한 서브 터미널이 별도 Run의 coordinator가 되는 논리적 계층**을 뜻합니다.

---

## 1. 실측 결과: 능력 경계표

실험 Run: `run_23fa5106932d`(1차, 워커 2종을 같은 워크트리에 띄워 3개 태스크) + `run_018eda73019a`(2차 통제 실험, `ask` 호출 형태를 변수로 분리하고 Claude를 양성 대조군으로 배치) + `run_87b2e6509f8c`(3차 계층 실험, 서브 오케스트레이터 2개와 Child Run 2개, 하위 워커 4개).

| # | 검증 항목 | 결과 | 근거 (실제 출력) |
|---|---|---|---|
| 1 | 워커 → **다른 워커**에게 직접 send | ✅ **가능** | codex 워커가 `send --to dispatch:ctx_51c8…` 실행 → `ok:true`, claude 워커가 `check --wait`로 46~50초 만에 수신. `to_handle`이 코디네이터가 아닌 상대 dispatch |
| 2 | 워커 → 코디네이터 blocking `ask` (Claude) | ✅ 가능 | 1차: `timedOut:false, cancelled:false`, 약 60초 만에 답변 수신. 2차 양성 대조(`task_0fe1e56d29eb`/`ctx_ad3c95be8439`): 질문 `msg_d061bd423af2` → 답변 `msg_8238668a57b3`(body `BLUE`) → `worker_done msg_6a500d36f1d2`에 exit 0 기록 |
| 3 | 워커 → 코디네이터 blocking `ask` (**Codex**) | ✅ **가능** | 2차(`task_219c9d4e2b6c`/`ctx_2ed9a2d1b73a`): 질문 `msg_13280684f608`이 메인 인박스 도착 → 메인 `reply msg_315646ed5af2`(body `BETA`) → `worker_done msg_250e37674332`에 **"`ask`가 5.29초 뒤 exit 0, `BETA` 수신"** 기록. 즉 **질문 → 대기 → 응답 수신 → 재개**가 Codex에서도 성립 |
| 3b | **인증 인자 없는 bare `ask`** (Claude / Codex) | ❌ **양쪽 다 불가** | 양쪽 모두 exit 1 + `{"code":"dispatch_capability_invalid","message":"The Dispatch capability is missing."}`. **에이전트 종류와 무관한 호출 형태 문제**이며, 1차 실험의 "Codex는 ask 불가" 결론은 이 교란 때문에 생긴 오판이었습니다 |
| 4 | `worker_done` 보고 (Claude / Codex) | ✅ 양쪽 가능 | 두 워커 모두 `outcome:succeeded`로 태스크 자동 completed 처리 |
| 5 | Claude **워커 안에서** 팀모드 서브에이전트 기동 | ✅ 가능 | 2개 동시 spawn, 첫 결과까지 **약 20~26초** |
| 6 | 팀모드 **형제 서브에이전트 간 P2P** | ✅ **가능(양방향)** | PeerX→PeerY 발신 `success:true`, `routing.sender:"PeerX"` (team-lead 경유 아님), PeerY 답장 수신 확인 |
| 7 | 서브에이전트의 피어 탐색(`ListAgents`) | ❌ 도구 없음 | 서브에이전트에서 `ToolSearch("select:ListAgents")` → `No matching deferred tools found` |
| 8 | 서브에이전트의 `SendMessage` | ⚠️ deferred | 초기 도구 목록에 없음 → `ToolSearch`로 스키마 로드 후에야 호출 가능 |
| 9 | Codex 서브에이전트 병렬 실행 | ✅ 가능 | `collaboration.spawn_agent` × 2 → `collaboration.list_agents`에서 둘 다 `running` |
| 10 | Codex **형제 서브에이전트 간 통신** | ❌ **불가** | 서브에이전트 도구 목록에 `collaboration.send_message` 부재 |
| 11 | Claude/Codex **세션 내부 서브에이전트** 인바운드 배달 트리거 | ⚠️ **턴 종료 시에만** | 내장 서브에이전트 mailbox는 sleep/폴링으로 턴을 열어두면 완료된 결과조차 배달 안 됨. 1차에서 10분 미수신 → 턴 종료 후 즉시 수신. **Orca L1의 `check --wait`에는 해당하지 않음** |
| 12 | `Agent(run_in_background:false)` | ⚠️ 동기 아님 | 팀모드에선 즉시 반환("running … via mailbox"). 완료 시 오는 것은 `idle_notification`뿐, 결과 본문은 재요청 필요 |
| 13 | Claude Code `ListAgents`(메인 레벨) | ✅ 다른 **세션**이 보임 | `Peer sessions (3)` — 같은 머신의 다른 Claude Code 세션. in-process 서브에이전트는 안 보임 |
| 14 | 부모 워커가 별도 Run의 **서브 오케스트레이터**로 전환 | ✅ **가능** | 부모 Dispatch로 실행 중인 Codex/Claude가 각각 `run-create` 성공: `run_e05c958ddf21`, `run_2faebe89c6b1`. 각 터미널이 새 Run의 `coordinator_handle`로 기록됨 |
| 15 | 서브 오케스트레이터 → 하위 워커 fan-out | ✅ **가능** | 각 Child Run에서 실제 `task-create` + `worker-start`로 워커 2개씩 생성. 하위 Task/Dispatch 4개 모두 `completed`, `failure_count:0` |
| 16 | 하위 워커 → 서브 오케스트레이터 blocking `ask` | ✅ **가능** | Child 1: `msg_05afcfd296e8` → `GREEN`(`msg_86c1c2b668b3`), Child 2: `msg_8f88f54a88cb` → `SQUARE`(`msg_5c0b1141c6bf`). 두 워커 모두 답을 받고 재개해 `worker_done` 성공 |
| 17 | 서브 오케스트레이터 → 부모 Run `heartbeat`/`worker_done` | ✅ **가능** | Child Run으로 inbox가 재바인딩된 뒤에도 **원래 부모 Dispatch capability**로 상향 전송 성공. 부모 Task 2개가 자동 `completed` 처리됨 |
| 18 | 한 터미널이 부모·Child Run inbox 동시 소비 | ❌ **불가** | `run-create`가 해당 터미널의 coordinator binding을 Child Run으로 바꿈. 이후 기본 `check`는 Child Run mail만 소비하며 부모 mail을 동시에 읽을 수 없음 |

### 이 표에서 나오는 설계 원칙 4가지

- **원칙 A — "주입된 명령 템플릿을 그대로 써라."** (#2, #3, #3b) Orca는 각 live dispatch의 preamble에 `--from` 등 인증 인자가 채워진 정식 명령 템플릿을 주입합니다. 워커가 이걸 무시하고 기억으로 bare 명령을 만들면 **에이전트 종류와 무관하게** `dispatch_capability_invalid`로 실패합니다. → 태스크 spec에 **"preamble의 템플릿을 복사해서 쓰고, 인자를 임의로 줄이지 마라"**를 명시하세요. (이 실수 하나가 초판의 결론 하나를 통째로 뒤집었습니다 — 강의에서 그대로 교재로 쓸 만한 사례입니다.)
- **원칙 B — "세션 내부에서 협업이 필요한 덩어리는 Claude, 독립적으로 완결되는 덩어리는 Codex."** (#5, #6, #10) 질문 능력은 양쪽 다 있으므로 배치 기준이 아닙니다. 갈리는 건 **한 세션 안에서 여러 서브에이전트가 서로 이야기하며 합의해야 하는가**입니다. 그런 덩어리는 Claude 워커 1개 + 그 안의 팀모드로 내리고, 하나의 결과물로 닫히는 덩어리는 Codex 워커에 줍니다.
- **원칙 C — "세션 내부 mailbox는 폴링하지 말고 턴을 닫아라."** (#11, #12) 이 제약은 Claude/Codex의 **in-process 서브에이전트 mailbox**에 관한 것입니다. 반대로 Orca L1 coordinator는 공식 `check --wait`로 워커 mail을 기다리는 것이 정상 사용법입니다. 두 계층의 대기 모델을 섞지 마세요.
- **원칙 D — "계층마다 Run을 분리하고, 상향 보고 capability를 보존하라."** (#14~#18) 서브 오케스트레이터는 Child Run의 inbox를 전담하고, 하위 완료를 집계한 뒤 원래 부모 Dispatch capability로 `worker_done`을 올립니다. 한 터미널에 부모·Child Run inbox를 동시에 맡기지 마세요.

---

## 2. 통신 계층은 3층이다 (강의 슬라이드 1장으로 쓸 그림)

```
[L1] Orca Run 메시지 버스
     Main Run
     ├─ 코디네이터 ↔ 일반 워커 : dispatch / worker_done / ask·reply / heartbeat
     ├─ 워커 ↔ 워커            : send --to dispatch:<peer>  ← 직접 통신(실측)
     └─ 서브 오케스트레이터 Dispatch
          └─ Child Run (별도 namespace/inbox)
               ├─ 하위 워커 A ──ask/worker_done──► 서브
               └─ 하위 워커 B ──worker_done─────► 서브
          서브 ──부모 Dispatch capability로 worker_done──► Main Run

        │                                   │
        ▼                                   ▼
[L2] Claude Code 팀모드              [L3] Codex 서브에이전트
     team-lead                            main codex
     ├─ SubA ◄────► SubB  (P2P 가능)      ├─ explorer   (P2P 불가)
     └─ SubC                              └─ momus       ↑ 메인하고만
```

- **L1은 "세션 간"**, L2/L3는 **"세션 내부"**입니다. 강의에서 이 둘을 섞어 설명하면 학습자가 반드시 헷갈립니다. 특히 #11의 턴 종료 배달 제약은 L2/L3 mailbox 이야기이지, L1 `check --wait` 이야기와 다릅니다.
- L1은 CLI 명령(`orca orchestration …`)으로 움직이고, L2는 Claude 내장 도구(`Agent`/`SendMessage`), L3는 Codex 내장 도구(`collaboration.*`)로 움직입니다. **주소 체계가 완전히 다릅니다.**
- `lecture-concept.md`의 "메인이 모든 걸 중재한다"는 **L1의 기본값일 뿐이고 강제 사항이 아닙니다.**
- L1 계층화는 가능하지만 **Run 사이에 네이티브 parent-child 필드가 생기는 것은 아닙니다.** Main/Child Run은 원장에서 독립 namespace이고, 부모 Dispatch capability를 보존한 서브 오케스트레이터가 둘을 논리적으로 연결합니다.

---

## 3. 오케스트레이션 패턴 카탈로그

### P1. 감독형 팬아웃 (Supervised Fan-out)
```
메인 ──┬── codex#1  (독립 태스크 A)
       ├── codex#2  (독립 태스크 B)
       └── codex#3  (독립 태스크 C)
             └─ 각자 worker_done → 메인이 check --wait로 수거
```
- **언제:** 태스크끼리 서로 몰라도 되고, 만지는 파일이 겹치지 않을 때. 원칙 B의 "독립적으로 완결되는 덩어리".
- **안 쓸 때:** 태스크 간 인터페이스 합의가 필요할 때(→ P2). 같은 파일을 두 워커가 만질 때(→ 워크트리 분리 또는 직렬화).
- **핵심 명령:** 태스크를 **전부 먼저 만들고 워커를 전부 띄운 뒤에** 기다립니다. 하나 띄우고 기다리면 병렬성이 사라집니다.
```bash
orca orchestration run-create --objective "..." --json
orca orchestration task-create --spec "api-listing: ..." --json
orca orchestration task-create --spec "api-auth: ..."    --json
orca orchestration worker-start --task <A> --worktree current --agent codex --json
orca orchestration worker-start --task <B> --worktree current --agent codex --json
orca orchestration check --wait --types worker_done,escalation,question --timeout-ms 900000 --json
```
- **함정:** `check --wait`는 **가장 오래된 Delivery 배치 하나**를 반환하고 `--ack` 전까지 같은 배치를 계속 재생합니다. 실험 중 실제로 "같은 worker_done이 또 왔다"고 착각하기 쉬웠습니다. → **처리 후 반드시 `--ack <delivery_id>`.**

### P2. 중첩 팀 (Nested Team) — `lecture-concept.md`의 그림 1번
```
메인 ──── claude 워커 ──┬── front-dev (팀모드)
                        ├── api-dev   (팀모드)   ← 서로 P2P 통신 가능(실측)
                        └── test-fixer
```
- **언제:** **인터페이스 협상이 필요한 덩어리**. 예: 프런트가 쓸 API 응답 스키마를 프런트/백이 주고받으며 맞춰야 할 때. L2 P2P가 실측으로 확인됐으므로, 이 협상이 메인을 거치지 않고 워커 내부에서 끝납니다 → **메인의 컨텍스트를 아끼는 것이 이 패턴의 진짜 이득**.
- **안 쓸 때:** 서로 무관한 작업. 팀모드는 조정 오버헤드가 있어 독립 작업엔 P1이 빠릅니다.
- **함정 (실측):** 팀 리드(=claude 워커)가 서브에이전트 결과를 **기다리면 안 됩니다.** 1차 실험에서 리드가 sleep 폴링으로 10분을 기다렸으나 아무것도 못 받았고, 턴을 끝내자 즉시 도착했습니다. 서브에이전트 프롬프트에도 "보내고 턴 종료"를 명시해야 합니다.
- **함정 2:** 서브에이전트에겐 `ListAgents`가 없어 **피어를 탐색할 수 없습니다.** 통신시키려면 **팀메이트 이름을 프롬프트에 하드코딩**해서 알려줘야 합니다. 스폰 시점의 로스터 스냅샷도 갱신되지 않으므로 "명단에 없다=없는 사람"이 아닙니다.

### P3. 검토 게이트 루프 (Review Gate Loop) — `lecture-concept.md`의 그림 2번
```
메인 ──► claude 워커(팀모드) ──► [산출물] ──► codex 게이트 검토
          ▲                                        │
          └──────── 재지시(수정 지시 + 근거) ◄──────┘   (최대 N회)
```
- **언제:** 품질 기준이 명확하고 "합격/불합격"으로 끊을 수 있는 지점. 보안, 스펙 준수, 테스트 커버리지, 접근성.
- **왜 codex를 게이트에 두나:** ① 구현자가 자기 코드를 리뷰하면 방어합니다. ② **다른 모델**이라 실패 모드가 독립적입니다. ③ 게이트는 **입력=diff, 출력=판정**으로 한 세션 안에서 닫히는 덩어리라 원칙 B에 부합합니다(내부 협업 불필요). 판정 기준이 애매해 물어봐야 할 상황이 생겨도 Codex가 `ask`로 되물을 수 있으므로(실측), 게이트를 codex에 두는 데 통신상의 제약은 없습니다.
- **codex 게이트에 시킬 만한 역할 (강의에서 3개 정도 시연 권장):**
  1. **security-reviewer** — Supabase RLS 정책 누락, 서비스 롤 키 클라이언트 노출, 인증 우회 경로
  2. **spec-conformance** — 스펙 문서와 구현의 항목별 대조 (수용 조건 체크리스트 → PASS/FAIL 표)
  3. **test-adequacy** — 테스트가 실제로 실패를 잡는지 (통과하는 테스트를 의도적으로 깨보게 시키는 mutation 감각)
  4. **momus (기존 codex 에이전트 그대로 활용)** — 계획 실행가능성 판정. `OKAY / ITERATE / REJECT` 3값을 이미 출력하게 되어 있어 **게이트 판정기로 바로 쓸 수 있습니다.**
- **루프 종료 조건을 반드시 정하세요:** "REJECT 2회 연속이면 사람에게 에스컬레이션". Orca는 한 태스크에서 **3회 연속 실패하면 circuit-break**하여 태스크를 failed로 만듭니다.

### P4. 적대적 TDD 페어 (Adversarial TDD) — 이 강의의 하이라이트 추천
```
[RED]   codex test-author ──► 실패하는 테스트 작성 (구현 코드 접근 금지)
                │ (파일로 전달: tests/*.spec.ts)
[GREEN] claude 워커 ──────► 테스트를 통과시키는 최소 구현
[REFACTOR] 같은 claude 워커가 green 상태에서 즉시 정리
[GATE]  codex reviewer ──► 테스트가 구현에 맞춰 약해지지 않았는지 검증
```
- **왜 이게 멀티에이전트 TDD의 핵심인가:** 한 에이전트가 테스트와 구현을 다 쓰면 **구현이 편한 쪽으로 테스트가 휘어집니다.** 작성자와 구현자를 물리적으로 분리하면 이 왜곡이 구조적으로 차단됩니다. "에이전트를 나누는 이유"를 학습자에게 납득시키기 가장 좋은 예시입니다.
- **통신 수단은 메시지가 아니라 "파일"입니다.** 테스트 파일 자체가 계약서라서 단계 간 대화 왕복이 필요 없고, 그래서 세션 경계를 넘겨도 손실이 적습니다(원칙 B의 전형적인 "독립 완결" 덩어리).
- **강의 시연 포인트:** 스펙을 일부러 애매하게 준 뒤, codex test-author가 **`ask`로 되물어 오는 장면**을 보여주세요(Codex도 blocking 질문이 됩니다 — 실측). 그다음 스펙을 완결시켜 재실행하면 질문 없이 한 번에 끝납니다. "질문할 수 있다"와 "질문할 필요가 없게 스펙을 만든다"는 별개라는 걸 대비로 각인시킬 수 있습니다.

### P5. 워커 직결 릴레이 (Peer Relay) — "메인이 다 중재한다"를 깨는 패턴
```
메인 ─(태스크 배포만)─┬── 워커A ──send --to dispatch:B──► 워커B ──► 워커C
                      └── (메인은 worker_done만 수거)
```
- **실측 근거:** codex 워커 → claude 워커 직접 전달 성공. 수신자는 `check --wait`로 받습니다.
- **언제:** 산출물이 **한 방향으로 흐르는 파이프라인**인데 메인이 중간 산출물을 볼 필요가 없을 때. 예: `스키마 확정 → API 구현 → 프런트 연동`. 메인이 매 단계 받아서 다시 보내면 메인 컨텍스트가 중간 산출물로 오염됩니다.
- **선행 조건:** 보내는 쪽이 **받는 쪽의 dispatchId를 알아야 합니다.** 메인이 워커를 먼저 띄워 ID를 확보한 뒤, 후속 워커의 task spec에 상대 주소를 박아 넣으면 됩니다(이 문서의 실험이 그렇게 했습니다).
- **함정:** 수신자가 `check`를 하지 않으면 메시지는 그냥 인박스에 쌓입니다. **수신자 spec에 "언제 check 하라"를 명시**해야 합니다. 그리고 릴레이 중 사고가 나면 메인이 모르므로, **worker_done만은 반드시 메인으로** 오게 유지하세요.

### P6. 터미널 승계 파이프라인 (Terminal Handoff)
```
task1 ──► 워커(term_X) ──worker_done──► 메인 ──► worker-start --terminal term_X --task task2
                                                 (같은 세션 = 컨텍스트 유지, 재탐색 비용 0)
```
- **실측:** 2차 실험에서 1차 claude 워커의 터미널을 그대로 재사용해 새 dispatch를 붙였습니다(`ctx_51c8…` → `ctx_8051…`). 워커는 앞선 실험 기억을 유지한 채 이어서 작업했습니다.
- **언제:** 같은 코드 영역에 연속 작업(구현 → 리뷰 반영 → 리팩터)을 시킬 때. 새 워커를 띄우면 파일 재탐색부터 다시 합니다.
- **주의:** 재사용할 거면 `worker-release`를 하지 마세요. 반대로 재사용 안 할 거면 **완료된 워커는 반드시 release**해야 터미널이 정리됩니다(안 하면 실험처럼 유령 터미널이 남습니다).

### P7. 사람 결정 게이트 (Human-in-the-loop Gate)
```
워커 ──ask──► 메인 ──(사람에게 질문)──► 사람 ──► reply ──► 워커 재개
       또는  메인이 gate-create로 DAG 진행을 막고 사람 판단을 대기
```
- **`ask` vs `gate-create` 구분:** `ask`는 **워커가 막혔을 때 워커가 던지는 질문**, `gate-create`는 **코디네이터가 DAG 진행을 스스로 멈추는 결정 지점**입니다.
- **`ask`는 Claude·Codex 양쪽 워커에서 모두 동작합니다**(실측, `run_018eda73019a`). Codex 워커가 질문을 던지고 **5.29초 만에 메인의 답(`BETA`)을 받아 작업을 재개**했고, 같은 실험의 Claude 대조군도 동일하게 왕복했습니다(`BLUE`). → **"막히면 물어볼 수 있어야 하는 태스크"를 codex에 줘도 됩니다.**
- **⚠️ 단, 호출 형태가 전부입니다:** 인증 인자 없이 기억에 의존해 만든 bare `ask`는 **양쪽 다** `dispatch_capability_invalid`로 즉시 실패합니다. 워커는 반드시 **자기 dispatch preamble에 주입된 `ask` 템플릿**(`--from` 등 포함)을 그대로 써야 합니다. 태스크 spec에 이 문장을 넣어두세요.
- **blocking이 부담스러울 때의 대안:** 답을 기다릴 필요까진 없는 보고성 판단 요청은 `escalation` 타입 `send`로 대신할 수 있습니다. 대신 이건 blocking이 아니라 워커가 그 자리에서 멈추지는 않습니다.
- **강의 시연:** 감자마켓 "거래 완료 처리 시 판매자/구매자 중 누가 확정하나?" 같은 **제품 결정**을 게이트로 잡으면 비개발자 학습자에게 설득력이 큽니다.

### P8. 다관점 심사단 (Panel)
```
[동일 산출물] ──┬── codex(보안 렌즈)    ──┐
                ├── codex(성능 렌즈)    ──┼─► 메인이 취합 → 2/3 이상 지적된 것만 채택
                └── codex(UX/접근성 렌즈)──┘
```
- **언제:** 판정이 갈릴 수 있는 중요 산출물(인증 로직, 결제, 개인정보). 단일 리뷰어는 놓치고, 3명이 같은 프롬프트면 같은 걸 놓칩니다. **렌즈를 다르게 주는 게 핵심**입니다.
- **비용 대비:** 매 PR마다 돌리면 낭비입니다. "인증/결제/RLS 건드린 PR"에만 트리거하도록 강의에서 조건을 명시하세요.

### P9. 계층형 Run 오케스트레이션 (Hierarchical Runs)
```
Main Run
├─ Sub-orchestrator 1 (부모 Dispatch)
│  └─ Child Run 1
│     ├─ Worker 1 ──ask/reply──► Sub 1
│     └─ Worker 2 ──worker_done► Sub 1
└─ Sub-orchestrator 2 (부모 Dispatch)
   └─ Child Run 2
      ├─ Worker 3 ──ask/reply──► Sub 2
      └─ Worker 4 ──worker_done► Sub 2

Sub 1/2 ──집계된 worker_done(원래 부모 capability)──► Main Run
```
- **실측 근거:** `run_87b2e6509f8c`에서 메인이 Codex 서브 1개와 Claude 서브 1개를 실제 Dispatch로 띄웠습니다. 두 서브는 각각 `run_e05c958ddf21`, `run_2faebe89c6b1`을 만들고 하위 워커 2개씩을 직접 감독했습니다. 부모 2개 + 하위 4개, 총 6개 Dispatch가 모두 `completed`, `failure_count:0`이었습니다.
- **언제:** 메인이 직접 관리하기엔 워커 수가 많고, 작업군별로 질문·완료·실패를 로컬하게 집계할 중간 책임자가 필요할 때. 예: `프런트 작업군`, `API 작업군`, `배포·검증 작업군`을 각 서브 오케스트레이터가 맡는 경우.
- **동작 방식:** 서브는 부모 Run에서는 **하나의 워커 Dispatch**이면서, 자기 Child Run에서는 **coordinator**입니다. Child Run의 `question`과 `worker_done`을 `check --wait`로 처리하고, 모두 정산된 뒤 원래 부모 Dispatch preamble의 capability로 집계 결과를 상향 `worker_done`합니다.
- **중요한 경계:** 이것은 **한 Run 안의 재귀 Task DAG가 아닙니다.** 두 Child Run의 Task `parent_id`는 부모 Run Task를 가리키지 않습니다. Run/Task 원장에는 세 Run이 독립적으로 존재하고, 부모 Dispatch ID를 가진 상향 보고가 논리적 계층을 만듭니다.
- **inbox 제약:** 서브가 `run-create`를 실행하면 그 터미널의 coordinator binding이 Child Run으로 바뀝니다. 이후 서브의 기본 `check`는 Child Run을 소비합니다. 같은 터미널에서 부모 Run inbox까지 동시에 감독하도록 설계하면 안 됩니다. 부모가 서브에게 새 지시를 밀어 넣어야 한다면 이 제약을 감안해 별도 제어 경로나 명시적 메시지 설계를 두어야 합니다.
- **capability 제약:** Child Run을 만들기 전에 부모 dispatch preamble에 주입된 `worker_done`/`heartbeat` 명령과 capability를 보존해야 합니다. Child Run binding으로 바뀐 뒤에도 이 capability가 부모 Run으로 돌아가는 유일한 검증된 상향 경로입니다.
- **운영 규칙:** 각 서브는 하위 Delivery를 처리·ack하고 하위 터미널을 release한 다음 부모에게 완료를 보고합니다. 메인은 서브의 집계만 받되, 최종 검증 시에는 필요하면 각 Child Run의 `task-list`/`dispatch-show`를 독립 조회합니다.

### 패턴 선택 치트시트

| 상황 | 패턴 | 워커 배치 |
|---|---|---|
| 서로 무관한 화면 3개 만들기 | P1 | codex × 3 |
| API 스키마를 프런트/백이 맞춰야 함 | P2 | claude 워커 1 (내부 팀모드) |
| 구현 끝, 품질 확인 필요 | P3 | claude 구현 + codex 게이트 |
| TDD 사이클 | P4 | codex(test) → claude(impl) |
| 단방향 파이프라인, 메인 개입 불필요 | P5 | 워커 직결 |
| 같은 영역 연속 작업 | P6 | 터미널 승계 |
| 제품 의사결정 필요 | P7 | claude·codex 어느 쪽이든 (`ask` 양쪽 가능) |
| 고위험 코드 리뷰 | P8 | codex × 3 (렌즈 분리) |
| 워커가 많아 작업군별 중간 감독이 필요 | P9 | 메인 → 서브 오케스트레이터별 Child Run → 하위 워커 |

---

## 4. 서브에이전트 구성 — 질문에 대한 직답

### Q1. TDD를 제대로 하려면 `refactor` 역할을 따로 둬야 하나?
**아니요. 두지 마세요.** 이유 3가지:
1. TDD의 refactor는 **green 직후의 컨텍스트(방금 쓴 코드 + 통과하는 테스트)에 100% 의존**합니다. 새 에이전트는 그 컨텍스트를 처음부터 다시 로드해야 하고, 그 비용이 리팩터링 자체보다 큽니다.
2. refactor는 5~30줄짜리 **마이크로 스텝**입니다. 에이전트 경계를 넘길 단위가 아닙니다.
3. 실제로 필요한 분리는 refactor가 아니라 **"테스트 작성자 ↔ 구현자"** 분리입니다(P4). 여기가 진짜 왜곡이 생기는 지점입니다.

→ **대신 `api-developer` / `front-developer`의 프롬프트에 red-green-refactor 3단계를 강제로 넣으세요.** "테스트가 green이 된 후 반드시 리팩터 단계를 수행하고, 그 결과 테스트가 여전히 green임을 확인하라."

**예외:** "구조 개선"처럼 커밋 단위로 큰 리팩터링은 TDD 사이클이 아니라 **독립 태스크**입니다. 그때만 별도 워커(P6로 터미널 승계)를 쓰세요.

### Q2. `front-refactor` / `api-refactor`로도 나눠야 하나?
**아니요.** 역할을 **동사(설계/구현/리팩터/테스트) × 영역(front/api)** 으로 곱하면 N×M으로 폭발하고, 에이전트 수가 늘수록 컨텍스트 전달 비용이 산출물 가치를 넘습니다.

**나누는 기준은 하나여야 하고, 그 기준은 "같은 파일을 동시에 만지면 안 되는 경계"입니다.**
- 같은 파일을 만질 가능성이 있다 → **한 워커 안의 순차 단계**로.
- 파일이 확실히 갈린다 → **별도 워커로 병렬**.

감자마켓 기준으로는 `app/(front)` / `app/api`+`supabase/` 정도가 자연스러운 경계입니다.

### Q3. PR 처리용으로 `security-reviewer`, `code-refactor`를 둬야 하나?
- **`security-reviewer`: 둡니다. 단, "역할 분업"이 아니라 "관점 독립성" 때문입니다.** 구현자에게 보안 검토를 맡기면 자기 코드를 방어합니다. 그리고 **codex 쪽에 두세요** — 다른 모델이라 실패 모드가 겹치지 않고, 보안 리뷰는 다른 역할과 협의할 것 없이 한 세션 안에서 닫히는 작업이라 원칙 B에 맞습니다. (판정이 애매하면 `ask`로 되물을 수도 있습니다.)
- **`code-refactor`: 새로 만들지 마세요.** 리뷰 지적사항 수정은 **그 코드를 쓴 developer가** 해야 합니다(P6 터미널 승계로 컨텍스트 유지). 새 에이전트에게 "이 지적 고쳐"라고 하면 코드 의도를 몰라 엉뚱하게 고칩니다.

### Q4. 그래서 codex 세션 1, 2, 3에는 뭘 시키나?
**기준은 "질문할 필요가 없는 일"이 아닙니다**(Codex도 `ask`로 물어볼 수 있으니까요). **"한 세션 안에서 혼자 완결되는 일"** 이 기준입니다.

| codex 세션 | 맡길 일 | 왜 codex인가 |
|---|---|---|
| codex#1 | **테스트 작성자(RED)** | 스펙이 입력, 테스트 파일이 출력. 구현자와 분리되어야 함 (P4). 산출물이 파일 하나로 닫힘 |
| codex#2 | **검토 게이트** (security / spec-conformance) | 입력=diff, 출력=판정. 다른 모델이라 실패 모드가 독립적 (P3) |
| codex#3 | **독립 조사·검증** (Supabase RLS 문법 확인, Vercel 배포 설정 검증, 라이브러리 조사) | 이미 `librarian`/`explorer` 서브에이전트가 있어 바로 활용 가능 |

**반대로 codex에 주면 안 되는 일:** **여러 역할이 서로 이야기하며 합의해야 완성되는 덩어리**입니다. 예: 프런트와 API가 응답 스키마를 주고받으며 맞춰야 하는 작업. Codex 서브에이전트는 형제끼리 통신할 수단이 없어서(#10) 그 협의가 전부 메인 codex를 경유해야 하고, 그러면 세션 하나가 병목이 됩니다. → 그건 Claude 워커 + 팀모드(P2)로.

> **주의 — 초판에서 정정된 부분:** 이 항목의 원래 기준은 "Codex는 질문을 못 하니 스펙이 애매한 일을 주지 마라"였습니다. 전제가 틀렸으므로 폐기합니다. 스펙을 완결시켜 주는 건 여전히 좋은 습관이지만, **그건 Codex의 제약 때문이 아니라 모든 에이전트에게 공통으로 좋은 것**입니다. 스펙이 덜 여문 신규 기능 설계도 `ask` 왕복을 감수한다면 codex에 줄 수 있습니다.

### 최종 구성안 (감자마켓 실습용)

**Claude Code 측** — `.claude/agents/*.md` (팀모드 서브에이전트, 상호 통신 활용)
```
api-developer     : Supabase 스키마 + Route Handler 구현. red-green-refactor 강제.
front-developer   : Next.js 화면/폼/상태. api-developer와 응답 스키마 직접 협의(P2).
integrator        : 두 결과 합류 지점 검증, 타입/계약 불일치 해소. (선택)
```
**Codex 측** — `~/.codex/agents/*.toml` (이미 있는 5개 + 신규 2개)
```
[기존 활용]
  plan      : 스펙 → 실행 가능한 태스크 분해
  metis     : 스펙 갭 분석 (모순/모호/누락 제약) ← 스펙 주도 개발의 입구
  momus     : 실행가능성 판정 OKAY/ITERATE/REJECT ← 게이트 판정기로 그대로 사용
  explorer  : 코드 위치 탐색
  librarian : Supabase/Vercel/Next.js 외부 문서 조사
[신규 추가 권장]
  test-author      : 스펙 → 실패하는 테스트 작성 (구현 코드 수정 금지를 프롬프트에 명시)
  security-reviewer: RLS/인증/키 노출 전용 렌즈
```

> 참고: `front-designer` / `api-designer`를 따로 두는 것은 **실습 초반 1회성 설계 단계**에만 유용합니다. 상시 역할로 두면 매 사이클마다 설계→구현 핸드오프 비용이 붙습니다. 설계는 **메인 세션이 사람과 함께** 하고, 산출물(스펙 문서)을 태스크 spec에 담는 편이 강의 흐름상 더 깔끔합니다.

---

## 5. 강의 실습 시나리오 (패턴 시연 순서)

각 챕터는 "패턴 1개 + 그 패턴이 필요한 이유"로 구성합니다.

| Ch | 내용 | 시연 패턴 | 학습 포인트 |
|---|---|---|---|
| 1 | 감자마켓 스펙 초안 작성 → codex `metis`로 갭 분석 → `momus`로 실행가능성 판정 | P3, P7 | "AI에게 일 시키기 전에 스펙을 완결시켜야 하는 이유"를 게이트가 대신 증명해줌 |
| 2 | 태스크 DAG 만들기 (`task-create --deps`) | — | 의존성 깊이는 3~4단계 이하로 |
| 3 | RED: codex가 실패 테스트 작성 | P4 | 테스트 작성자와 구현자를 왜 분리하나 |
| 4 | GREEN: claude 워커 1개를 띄우고 그 안에서 front/api 팀모드 병렬 구현 | P2 | 서브에이전트 간 P2P로 API 계약 협상 (메인 개입 0회) |
| 5 | 동시에 codex 3개로 독립 작업 병렬 (배포 설정, RLS 검증, 문서) | P1 | claude 1 + codex 3 = 워커 4개 구조 (원 구상 그대로) |
| 6 | 보안 게이트 루프: codex security-reviewer → 재지시 → 통과 | P3, P6 | 지적 수정은 원 구현자가 (터미널 승계) |
| 7 | 워커 직결 릴레이 시연: 메인을 거치지 않고 워커→워커 전달 | P5 | **"메인이 병목이 아니다"** — 강의의 하이라이트 |
| 8 | 메인 → 서브 2개 → 하위 워커 4개의 계층 구조 시연 | P9 | 별도 Child Run, 로컬 `ask/reply`, 집계된 상향 `worker_done`; 단일 Run 재귀 DAG와의 차이 |
| 9 | PR/이슈 처리, Vercel 배포 | P8 | 고위험 변경에만 심사단 |

**Ch4+Ch5를 동시에 돌리면 `lecture-concept.md`의 첫 번째 그림이 화면에 그대로 재현됩니다.** 메인 세션은 워커 4개와 통신하고, 그중 claude 워커만 내부에서 다시 갈라집니다.

---

## 6. 강의에서 반드시 짚어야 할 함정 (전부 실측으로 겪은 것)

1. **세션 내부 서브에이전트 mailbox를 sleep 폴링하면 영원히 못 받습니다.** Claude/Codex in-process 서브에이전트가 결과를 기다리며 턴을 열어두면 인바운드가 배달되지 않습니다. 1차 실험에서 10분을 날렸고, 턴을 닫자 즉시 도착했습니다. → L2/L3 프롬프트에는 **"보내고 즉시 턴을 종료하라"**를 넣으세요. **Orca L1 coordinator가 `orchestration check --wait`로 기다리는 것은 정상이며 이 함정에 해당하지 않습니다.**
2. **`success: true`는 "전달됨"이 아니라 "큐에 넣음"입니다.** 응답이 올 거라는 보장이 아닙니다.
3. **스폰 시점 로스터는 갱신되지 않습니다.** 서브에이전트 목록에 상대가 없어도 메시지는 갑니다. 실험에서 PeerX는 "PeerY가 스폰 안 된 것 같다"고 **틀린 추측**을 보고했다가 정정했습니다.
4. **`check --wait`는 `--ack` 전까지 같은 배치를 재생합니다.** 처리 후 반드시 ack 하세요. 안 하면 같은 worker_done을 무한히 다시 봅니다.
5. **완료된 워커는 `worker-release`.** 안 하면 터미널이 계속 쌓입니다. 단, 이어서 쓸 거면 release 대신 `worker-start --terminal <handle>`.
6. **인증 인자를 뺀 bare 명령은 에이전트 종류와 무관하게 실패합니다.** 워커가 preamble에 주입된 템플릿 대신 기억으로 `ask`를 만들면 Claude·Codex **양쪽 다** exit 1 + `dispatch_capability_invalid`가 납니다. **이 오류만 보고 "이 에이전트는 그 기능이 없다"고 결론 내리면 안 됩니다** — 실제로 이 문서 초판이 그 오판을 했고, 통제 실험(`run_018eda73019a`)에서 Codex도 blocking `ask`가 정상 동작함이 확인됐습니다. 능력 부재를 주장하려면 **호출 형태를 통제하고 양성 대조군을 둔 실험**이 필요합니다. 강의에서 "AI 에이전트 검증은 이렇게 하는 것"의 예시로 쓰기 좋습니다.
7. **타임아웃은 실패가 아닙니다.** 실제 코딩 태스크는 15~60분 걸립니다. `check --wait` 타임아웃은 체크포인트일 뿐이니 계속 기다리세요.
8. **`--outcome failed`를 쓰게 하세요.** 실패를 본문에만 적으면 태스크 상태가 succeeded로 남습니다.
9. **서브의 `run-create`는 coordinator inbox를 Child Run으로 재바인딩합니다.** 계층 실험에서 서브는 Child Run mail을 정상 소비했지만 같은 터미널에서 부모 Run mail을 동시에 소비할 수 없었습니다. 대신 원래 부모 Dispatch capability를 보존하면 `heartbeat`와 최종 `worker_done`은 위로 보낼 수 있습니다. → **하향 감독은 Child Run inbox, 상향 보고는 부모 capability**로 역할을 분리하세요.

---

## 부록 A. 이 문서의 실험 재현 명령

```bash
# 1) Run 생성
orca orchestration run-create --objective "패턴 검증" --json

# 2) 태스크 생성 (워커에 줄 지시를 spec에)
orca orchestration task-create --spec "<지시문>" --json

# 3) 워커 기동 (현재 워크트리에 새 에이전트 터미널)
orca orchestration worker-start --task <task_id> --worktree current --agent claude --json
orca orchestration worker-start --task <task_id> --worktree current --agent codex  --json
#    → 응답의 dispatchId 를 기록. 워커 간 직접 통신(P5)에 이 값이 필요.

# 3-1) 워커 → 코디네이터 blocking 질문 (워커 터미널 안에서 실행, Claude·Codex 공통)
#      ⚠️ 반드시 각 dispatch preamble에 주입된 ask 템플릿을 그대로 사용할 것.
#         --from 등 인증 인자를 빼면 양쪽 에이전트 모두 dispatch_capability_invalid로 exit 1.
orca orchestration ask --question "<질문>" --options "yes,no" --timeout-ms <ms> \
  --from <preamble이 제공한 값> --dispatch-capability <preamble이 제공한 값> --json
#      → 인자 값은 손으로 짓지 말고 preamble의 템플릿을 복사할 것 (여기 적힌 건 형태 예시일 뿐)
#      코디네이터 측: check 로 question 수신 → reply --id <msg_id> --body "<답변>" → 워커의 ask 가 exit 0 으로 재개

# 4) 워커 → 워커 직접 통신 (워커 터미널 안에서 실행)
orca orchestration send --to dispatch:<peer_dispatch_id> --subject "..." --body "..." --json
orca orchestration check --wait --timeout-ms 300000 --json    # 수신 측

# 5) 코디네이터 수거 → 처리 → ack → 재대기
orca orchestration check --wait --types worker_done,escalation,question --timeout-ms 900000 --json
orca orchestration reply --id <msg_id> --body "<답변>" --json
orca orchestration check --ack <delivery_id> --wait --types worker_done,escalation,question --timeout-ms 900000 --json

# 6) 정리 / 승계
orca orchestration worker-release --dispatch <dispatch_id> --json          # 종료
orca orchestration worker-start  --task <next_task> --terminal <handle> --json  # 승계(P6)

# 7) 계층형 Run(P9): 메인이 서브 오케스트레이터를 일반 supervised worker로 시작
orca orchestration run-create --objective "hierarchical orchestration" --json
orca orchestration task-create --spec "별도 Child Run을 만들고 하위 워커를 감독한 뒤 집계 결과를 부모 worker_done으로 보고" --json
orca orchestration worker-start --task <sub_task_id> --worktree current --agent codex --json

# 7-1) 서브 터미널 안: 부모 preamble의 lifecycle 명령/capability를 먼저 보존한 뒤 Child Run 생성
orca orchestration run-create --objective "child work group" --json
orca orchestration task-create --spec "하위 작업 A" --json
orca orchestration task-create --spec "하위 작업 B" --json
orca orchestration worker-start --task <child_task_a> --worktree current --agent codex --json
orca orchestration worker-start --task <child_task_b> --worktree current --agent claude --json
orca orchestration check --wait --types worker_done,escalation,question --timeout-ms 900000 --json
# question에는 reply, 처리한 Delivery에는 ack, 완료된 하위 Dispatch에는 worker-release 수행

# 7-2) 하위 작업이 모두 정산된 뒤: 새 Child Run의 기본 send가 아니라
#      최초 부모 dispatch preamble에 주입됐던 worker_done 명령을 인자까지 그대로 실행
orca orchestration send --type worker_done ... \
  --task-id <parent_task_id> --dispatch-id <parent_dispatch_id> \
  --from <부모_preamble_값> --dispatch-capability <부모_preamble_값> --outcome succeeded --json
```

## 부록 B. 실험 원본 식별자

### 1차 실험 (패턴 탐색)

- Run: `run_23fa5106932d`
- Task: `task_1b1776889917`(claude 팀모드 검증) / `task_f4e2ca5220af`(codex 검증) / `task_9a8f947955fd`(ask·동기 검증)
- Dispatch: `ctx_51c88172626f`(claude 1차) / `ctx_e314f9819a54`(codex) / `ctx_8051ef039f6b`(claude 2차, 터미널 승계)
- 워커 간 직접 통신 메시지: `msg_b560505e49fb` (`to_handle: dispatch:ctx_51c88172626f`)
- Claude `ask` 왕복: 질문 `msg_eb4ef4e825e6` → 답변 `msg_6de91c8b7428` (`timedOut:false`)
- ⚠️ **무효 관측:** 이 Run에서 나온 "Codex `ask` → `dispatch_capability_invalid`"는 **인증 인자 누락으로 교란된 결과**입니다. 능력 부재의 근거로 인용하지 마세요. (아래 2차 실험이 반증)

### 2차 통제 실험 (`ask` 호출 형태를 변수로 분리)

- Run: `run_018eda73019a` — 환경 동일(`orca` 1.4.180 / `codex-cli` 0.147.0)
- **Codex 검증군:** Task `task_219c9d4e2b6c` / Dispatch `ctx_2ed9a2d1b73a`
  - 질문 `msg_13280684f608` (메인 인박스 도착 확인)
  - 메인 답변 `msg_315646ed5af2` (body `BETA`)
  - 보고 `msg_250e37674332` — **`ask`가 5.29초 뒤 exit 0, `BETA` 수신 확인**
- **Claude 양성 대조군:** Task `task_0fe1e56d29eb` / Dispatch `ctx_ad3c95be8439`
  - 질문 `msg_d061bd423af2` → 답변 `msg_8238668a57b3` (body `BLUE`) → 보고 `msg_6a500d36f1d2` (exit 0)
- **음성 조건(양쪽 공통):** 인증 인자 없는 bare `ask` → exit 1 + `dispatch_capability_invalid` / `The Dispatch capability is missing.`
- **결론:** 변수는 에이전트 종류가 아니라 **명령 호출 형태**. Codex도 authenticated live dispatch `ask`로 blocking 질문이 가능합니다.

### 3차 계층 오케스트레이션 실험

- **Main Run:** `run_87b2e6509f8c`
  - Sub 1(Codex): Task `task_6088698505c8` / Dispatch `ctx_b76f6866b516` / 상향 완료 `msg_10fcbdb63f5b`
  - Sub 2(Claude): Task `task_fa9b0dbaa433` / Dispatch `ctx_1874216f24d5` / 상향 완료 `msg_97b6d42d2efd`
- **Child Run 1:** `run_e05c958ddf21`, coordinator=`term_47da2dd8-e6b7-43cd-94de-eaa573d0820f`(Sub 1)
  - W1(Codex): Task `task_530b042c3385` / Dispatch `ctx_aa2870fe3e4c`
  - W1 질문 `msg_05afcfd296e8`(`SUB1_ASK_20260812`) → 답변 `msg_86c1c2b668b3`(`GREEN`) → 완료 `msg_77a7d1d34ec7`(`S1W1_OK_20260812`)
  - W2(Claude): Task `task_c6a2d9d25757` / Dispatch `ctx_40475984c324` / 완료 `msg_57f937d7970b`(`S1W2_OK_20260812`)
- **Child Run 2:** `run_2faebe89c6b1`, coordinator=`term_d8411c66-a945-4c0b-8f02-91c517b99f1e`(Sub 2)
  - W3(Claude): Task `task_393e981f4886` / Dispatch `ctx_b3c301f278fb`
  - W3 질문 `msg_8f88f54a88cb`(`SUB2_ASK_20260812`) → 답변 `msg_5c0b1141c6bf`(`SQUARE`) → 완료 `msg_92d76c1c7e8f`(`S2W3_OK_20260812`)
  - W4(Codex): Task `task_e4facbe2f3b4` / Dispatch `ctx_d12eac98cd49` / 완료 `msg_075f9e6aaa2d`(`S2W4_OK_20260812`)
- **최종 원장 검증:** 부모 2개와 하위 4개, 총 6개 Task/Dispatch가 모두 `completed`, `failure_count:0`. 여섯 worker terminal 모두 `releaseState:released`, transcript `captured`.
- **결론:** 별도 Child Run 기반 계층 감독과 `ask/reply`, 하위 완료 집계, 부모 Run 상향 보고는 가능. 단, Run 간 네이티브 parent-child 관계는 없고 한 터미널은 부모·Child Run inbox를 동시에 소비하지 못합니다.
