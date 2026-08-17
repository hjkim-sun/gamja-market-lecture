# 프로젝트 설명
이 프로젝트는 감자마켓 프로젝트로 물건을 사려는 구매 예정자가 구매를 원하는 물건의 스펙과 예상 가격대를 입력하면 판매하려는 사람이 지원하여 매칭하는 프
로젝트이다. (당근마켓과 유사하나 구매자 중심으로 진행되는 플랫폼)

# 프로젝트 설명
이 프로젝트는 감자마켓 프로젝트로 물건을 사려는 구매 예정자가 구매를 원하는 물건의 스펙과 예상 가격대를 입력하면 판매하려는 사람이 지원하여 매칭하는 프로젝트이다. (당근마켓과 유사하나 구매자 중심으로 진행되는 플랫폼)

# 프로젝트 기술 구조
본 프로젝트는 Next.js와 FastAPI 기반의 풀스택 웹 애플리케이션이다.

- Frontend: Next.js + TypeScript
- Backend: FastAPI + Python (uv)
- Database: Supabase PostgreSQL
- Deployment: Vercel

## 프로젝트 디렉토리 구조
frontend/   
  ├── public/
  ├── src/   
  │    ├── app/   
  │    ├── components/   
  │    ├── features/   
  │    ├── lib/   
  │    └── types/   
  ├── tests/  
  └── logs/
backend/   
  ├── app/  
  │    ├── main.py  
  │    ├── api/  
  │    ├── schemas/  
  │    ├── services/  
  │    ├── repositories/  
  │    ├── db/  
  │    └── core/   
  ├── tests/  
  └── logs/
docs/

## 설계문서 저장 
docs/specs 디렉토리안에 구현 단계별로 순번을 붙여 md 파일로 저장한다. 

# 개발 방식
기능 개발 요청시 기본적으로 orca orchestration 이용해 개발하며 `orchestration` 스킬을 사용한다. 
테스트 주도 개발 적용을 위해 새로운 기능 구현이나 기능 수정시에는 test를 먼저 작성한다. 

(1) 기본 패턴
main orchestrator --> designer worker --> tester worker(RED케이스 생성) ---> backend developer worker
                                                                      ├─> front developer worker

메인 오케스트레이터는 위 4개의 워커를 생성하며 backend worker와 front worker는 상호 통신할 수 있도록 상호 dispatch_id를 알려준다. 
단순한 수정 건에는 designer worker는 생략한다. 

## 지켜야 할 사항 
(1) 특정 워커의 작업이 완료되면 워커의 터미널을 닫지 말고 대기시킨다. 


