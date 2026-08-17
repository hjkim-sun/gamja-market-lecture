# 구해요 글 작성/관리 + 목록/상세 (M1)

> 대상 마일스톤: **M1 — 구해요 CRUD + 목록/상세**
> 근거: PRD §6 F1, §6 F2, §5.3(상태 전이), §7.2(성능/페이지네이션), §8(데이터 모델), §11(M1)
> 선행 스펙: [`auth-and-profile.md`](./auth-and-profile.md) — 이 스펙의 모든 쓰기 동작은 로그인과 프로필 등록을 전제한다.

## 목적

구매자가 "이런 물건을 이 가격대에 구합니다"를 글로 올리고, 누구나 그 글 목록을 최신순으로 훑고 상세를 열어볼 수 있게 한다.

## 사용자 시나리오

1. 로그인한 사용자가 글쓰기 화면에서 제목·설명·카테고리·희망 최저가~최고가·거래 지역을 입력하고 마감일을 고른다(비워두면 14일 후).
2. 저장하면 방금 만든 글의 상세 화면으로 이동한다.
3. 홈에서 최신순 목록을 본다. 각 항목에 제목, 가격 범위, 지역, 상태 배지, **제안 수**가 보인다.
4. 항목을 눌러 상세를 연다. 글 전문과 마감일이 보인다.
5. 자기 글의 상세에서는 수정 / 삭제 / 조기 마감 버튼이 보인다. 남의 글에서는 보이지 않는다.
6. 조기 마감한 글은 상세에서 "마감됨" 배지가 붙고, 기본 목록에서 사라진다.
7. 목록에 글이 하나도 없으면 "아직 구해요 글이 없어요" 화면이 보인다.
8. 없는 글의 URL을 열면 "글을 찾을 수 없습니다" 화면이 보인다.

## 데이터

### 신규 테이블 `requests`

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `id` | uuid | PK |
| `buyer_id` | uuid | NOT NULL, `profiles.id` 참조 |
| `title` | text | NOT NULL, 길이 2~60 |
| `description` | text | NOT NULL, 길이 1~2000 |
| `category` | text | NOT NULL, 길이 1~20. **자유 태그**(Q4 확정) — 허용 목록 검증 없음 |
| `price_min` | integer | NOT NULL, 0 이상 (단위: 원, KRW 정수) |
| `price_max` | integer | NOT NULL, 0 이상, **`price_max >= price_min`을 DB CHECK 제약으로 강제** |
| `region` | text | NOT NULL, 길이 1~30, 자유 입력 텍스트 (PRD §9: 지도/GPS 없음) |
| `status` | text | NOT NULL, 기본값 `'open'` |
| `expires_at` | timestamptz | NOT NULL, 기본값 `now() + interval '14 days'` |
| `created_at` | timestamptz | NOT NULL, 기본값 `now()` |
| `updated_at` | timestamptz | NOT NULL, 기본값 `now()` |

- `status`가 가질 수 있는 값은 **처음부터 5개 전부**를 정의한다: `open`, `matched`, `completed`, `closed`, `expired`. M1에서 저장 시 실제로 쓰이는 값은 `open`과 `closed` 둘뿐이지만, 나머지를 나중에 추가하면 마이그레이션이 한 번 더 필요하다.
- **`expired`는 저장되지 않는 파생 상태다.** M1에는 만료 배치가 없다. `expires_at <= now()`이고 `status = 'open'`인 글은 조회 시 `expired`로 보이고 기본 목록에서 제외된다. 배치로 실제 `status`를 갱신하는 일은 이 스펙의 범위 밖이다.
- **RLS를 켠다.** 읽기는 인증 사용자 전체, 쓰기/수정/삭제는 `buyer_id`가 본인인 행에만 허용하는 정책을 함께 둔다.
- `request_images`(PRD §8)는 **이 스펙에서 만들지 않는다.** 참고 사진은 선택 항목이고 저장소 정책이 미결(Q5)이다.

## API 계약

모든 엔드포인트는 인증(`Authorization: Bearer <JWT>`)을 요구한다. 에러 봉투는 `auth-and-profile.md`와 동일하다(`{ "code", "message" }`).

### `POST /requests`

- 본문: `{ title, description, category, price_min, price_max, region, expires_at? }`
  `expires_at`이 없거나 `null`이면 서버가 `now() + 14일`로 채운다. **클라이언트가 보낸 `buyer_id`는 무시한다.**
- 201: 생성된 글의 상세 표현(아래 `GET /requests/{id}`의 200과 동일)
- 400 `validation_error` — 필수 항목 누락, 길이 위반, `price_min > price_max`, `expires_at`이 과거
- 401 `unauthorized`
- 403 `profile_required` — 로그인은 되었으나 `profiles` 행이 없음

### `GET /requests`

- 쿼리: `page`(기본 1), `size`(기본 20, 최대 20)
- 200: `{ "items": [ <목록 항목> ], "page": 1, "size": 20, "has_next": false }`
  (페이지네이션의 정확한 형태 — offset 방식 vs cursor 방식 — 는 `backend-developer`가 계약에서 확정한다. 요구는 "한 번에 최대 20건"과 "다음 페이지 존재 여부를 응답만 보고 알 수 있을 것" 두 가지다.)
- 목록 항목: `{ id, title, category, price_min, price_max, region, status, offer_count, expires_at, created_at }`
  - **`offer_count`는 M1에서 항상 `0`이다.** 제안 테이블은 M2에서 생긴다. 필드를 지금 계약에 넣어 두는 이유는 M2에서 목록 화면을 다시 만들지 않기 위해서다.
  - 목록 항목에 `description`과 `buyer` 정보는 포함하지 않는다.
- 기본 정렬: `created_at` 내림차순, 동률이면 `id` 내림차순(페이지 경계에서 항목이 중복/누락되지 않도록).
- 기본 필터: `status = 'open'` **이고** `expires_at > now()`인 글만. (M1에는 필터 파라미터가 없다 — 범위 밖 참조.)
- 401 `unauthorized`

### `GET /requests/{id}`

- 200: `{ id, title, description, category, price_min, price_max, region, status, offer_count, expires_at, created_at, updated_at, buyer: { id, nickname }, is_mine }`
  - `buyer`에는 **닉네임까지만** 포함한다. 연락 수단은 어떤 경우에도 포함하지 않는다(PRD §7.3).
  - `is_mine`은 요청자가 작성자인지 여부. 프런트가 수정/삭제 버튼 노출을 판단하는 근거이며, 권한 판정 자체는 서버가 한다.
  - `status`는 파생 계산된 값이다(만료된 `open` 글은 `expired`로 내려간다).
- 401 `unauthorized`
- 404 `request_not_found` — 없는 id, 또는 삭제된 글

### `PATCH /requests/{id}`

- 본문: `title`, `description`, `category`, `price_min`, `price_max`, `region`, `expires_at` 중 보낸 필드만 수정.
- 200: 수정된 상세 표현
- 400 `validation_error`
- 401 `unauthorized`
- 403 `forbidden` — 작성자가 아님
- 404 `request_not_found`
- 409 `request_not_editable` — `status`가 `open`이 아님(마감·만료·성사된 글)

### `DELETE /requests/{id}`

- 204: 본문 없음. 하드 삭제.
- 401 `unauthorized`
- 403 `forbidden` — 작성자가 아님
- 404 `request_not_found`
- 409 `request_has_offers` — 제안이 1건 이상 달린 글. **M1에서는 이 조건이 발생할 수 없으나(제안 테이블 없음), 규칙은 지금 확정한다.** 근거: 제안이 달린 글이 사라지면 제안자의 제안도 함께 사라지므로, 이 경우 삭제 대신 조기 마감(`closed`)만 허용한다.

### `POST /requests/{id}/close`

조기 마감. `status`를 `closed`로 바꾼다.

- 200: 수정된 상세 표현
- 401 `unauthorized`
- 403 `forbidden` — 작성자가 아님
- 404 `request_not_found`
- 409 `request_not_open` — 이미 `open`이 아님

## 수용 조건

### 작성

- [ ] AC1: 제목·설명·카테고리·최저가·최고가·지역을 모두 채워 제출하면 201을 받고, 화면은 생성된 글의 상세로 이동한다.
- [ ] AC2: 필수 항목 중 하나라도 비어 있으면 제출 버튼이 동작하지 않고, **어떤 항목이 비었는지** 해당 입력란 옆에 표시된다.
- [ ] AC3: `price_min = 10000`, `price_max = 5000`으로 제출하면 저장되지 않고 400 `validation_error`를 받으며, 화면에 "최고가는 최저가보다 크거나 같아야 합니다" 취지의 메시지가 표시된다. `price_min = price_max`는 허용된다.
- [ ] AC4: API를 직접 호출해 `price_min > price_max`인 행을 넣으려 해도 **DB CHECK 제약에서 거부된다**(애플리케이션 검증만으로 통과되지 않는다).
- [ ] AC5: `expires_at`을 비우고 제출하면 저장된 글의 `expires_at`이 현재 시각 기준 14일 후(±1분)이다.
- [ ] AC6: 과거 날짜를 `expires_at`으로 제출하면 400 `validation_error`를 받는다.
- [ ] AC7: 가격 입력란은 모바일에서 숫자 키패드를 띄운다.
- [ ] AC8: 로그인하지 않은 상태로 `POST /requests`를 호출하면 401을 받고, 화면에서는 글쓰기 진입 자체가 `/login`으로 리다이렉트된다.
- [ ] AC9: 프로필(닉네임)을 만들지 않은 사용자가 `POST /requests`를 호출하면 403 `profile_required`를 받는다.
- [ ] AC10: 저장된 글의 `buyer_id`는 요청 본문이 아니라 **JWT의 `sub`** 에서 온다. 본문에 남의 user_id를 넣어도 무시된다.

### 목록

- [ ] AC11: 글이 3건 있으면 목록에 최신 작성 글이 맨 위에 온다.
- [ ] AC12: 목록의 각 항목에 제목, 가격 범위, 지역, 상태 배지, 제안 수가 보인다. 상태 배지는 **색상만이 아니라 텍스트로도** 상태를 알린다.
- [ ] AC13: 글이 0건이면 "아직 구해요 글이 없어요" 빈 상태 화면이 보인다. 이때 스켈레톤이나 무한 로딩이 남아 있지 않다.
- [ ] AC14: `closed` 상태인 글과 `expires_at`이 지난 글은 기본 목록에 나타나지 않는다.
- [ ] AC15: 21건이 있을 때 첫 응답의 `items` 길이는 20이고 `has_next`가 참이다. 다음 페이지를 요청하면 나머지 1건을 받고 `has_next`가 거짓이다.
- [ ] AC16: 목록 응답의 각 항목에 `offer_count` 필드가 있고 값은 `0`이다.
- [ ] AC17: 목록을 불러오는 동안 로딩 표시가 있고, 요청이 실패하면 에러 메시지와 다시 시도 수단이 보인다(빈 상태로 오인시키지 않는다).
- [ ] AC18: 375px 폭에서 목록 화면에 가로 스크롤이 없다.

### 상세

- [ ] AC19: 상세 화면에 제목, 설명 전문, 카테고리, 가격 범위, 지역, 마감일, 작성자 닉네임, 제안 수가 보인다.
- [ ] AC20: 상세 응답 어디에도 작성자의 `contact_type` / `contact_value` / 이메일이 포함되지 않는다.
- [ ] AC21: 없는 id로 상세를 열면 404 `request_not_found`를 받고 "글을 찾을 수 없습니다" 화면이 보인다(빈 상세 껍데기가 렌더되지 않는다).
- [ ] AC22: 자기 글 상세에는 수정/삭제/조기 마감 버튼이 보이고, 남의 글 상세에는 셋 다 보이지 않는다.
- [ ] AC23: 마감되었거나 만료된 글의 상세는 열리며, 상태 배지가 각각 "마감됨" / "기간 만료"로 표시된다.

### 수정 / 삭제 / 마감

- [ ] AC24: 작성자가 제목을 바꿔 저장하면 200을 받고 상세에 바뀐 제목이 보이며 `updated_at`이 갱신된다.
- [ ] AC25: **남의 글을 `PATCH` 또는 `DELETE` 하면 403 `forbidden`을 받는다.** 존재 여부와 무관하게 남의 글을 수정할 수 없다.
- [ ] AC26: 작성자가 삭제하면 204를 받고, 같은 id의 상세를 다시 열면 404다. 목록에서도 사라진다.
- [ ] AC27: 작성자가 조기 마감하면 상태가 `closed`가 되고, 기본 목록에서 사라지며, 같은 글을 다시 마감하려 하면 409 `request_not_open`을 받는다.
- [ ] AC28: `closed` 상태인 글을 `PATCH` 하면 409 `request_not_editable`을 받는다.
- [ ] AC29: 삭제 버튼은 확인 단계를 거친 뒤에만 실제 삭제를 호출한다.

## 범위 밖 (Non-goals)

- **키워드 검색, 카테고리/지역/상태 필터** — PRD §6 F2가 요구하지만 §11 마일스톤은 검색·필터를 **M4**에 배치한다. M1은 최신순 기본 목록만 만든다. (충돌 해소 근거는 갭 분석 참조.)
- **참고 사진 업로드(`request_images`)** — 선택 항목이며 저장소 정책이 미결(Q5). M2에서 제안 사진(필수)과 함께 다룬다.
- **제안(`offers`) 관련 일체** — 제안 목록 조회, 제안 수 실집계, "제안이 달린 글은 가격 범위·카테고리 수정 불가"(PRD §6 F1). 이 규칙은 M2에서 offers 테이블과 함께 구현한다. M1에서는 `offer_count`가 항상 0이므로 검증할 대상이 없다.
- 상세 화면에서의 제안 목록 노출(작성자 전용) — M2
- 무한 스크롤(PRD §7.2가 v2로 명시)
- 만료 배치 작업 — 파생 계산으로 대체
- 임시 저장(draft), 글 미리보기
- 이미지 압축(PRD §7.2) — M4

## 미결정 사항

- **~~Q4. 카테고리를 고정 목록으로 할 것인가, 자유 태그로 할 것인가?~~ → 자유 태그로 확정** (2026-08-13, PRD §12).
  - 작성 폼은 **텍스트 입력**. `select`를 만들지 않는다.
  - 서버 검증은 **길이(1~20자)만**. 허용 목록 검사도, `invalid_category` 코드도 없다.
  - 기존 값 자동완성은 M1 범위 밖이다(별도 조회 엔드포인트가 필요하므로 M4의 필터 작업과 함께 다룬다).
  - **넘겨받은 부채:** M4에서 필터를 붙일 때 "아이폰"과 "아이폰14"와 "아이폰 14"가 서로 다른 카테고리가 된다. 정규화(공백·대소문자)나 부분 일치 중 무엇으로 갈지는 **M4에서 결정한다.** M1에서는 입력값을 있는 그대로 저장한다.
- **Q5(PRD §12). 이미지 저장은 Supabase Storage인가, 버킷 공개 정책은?**
  M1에서는 이미지를 다루지 않으므로 지금 답할 필요는 없다. **M2 착수 전까지는 반드시 필요하다**(제안 사진은 최소 1장 필수).
- 통화 단위는 원(KRW) 정수로 고정했다. 소수점·다중 통화는 고려하지 않는다.
- 동시 수정(lost update) 방지는 M1 범위 밖이다. 같은 글을 두 탭에서 수정하면 나중 저장이 이긴다.
