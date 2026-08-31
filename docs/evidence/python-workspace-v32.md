# Python 프로젝트도 환경 준비와 구현을 분리하기

이번에는 **AI가 코드를 쓰기 전에 실행 환경이 제대로 준비되도록** 고쳤다.
작은 수정인데 패키지 설치부터 헤매거나, 기존 테스트 실패를 고치느라 모델을
반복 호출하는 일을 줄이기 위한 기반이다. 새로운 모델 구현 성공 사례는 아니다.

## 무엇이 달라졌나

공개 FastAPI 저장소에는 `backend/pyproject.toml`뿐 아니라 최상위의
`pyproject.toml`과 공통 `uv.lock`도 있었다. 기존 초기화는 backend 파일만
검증 입력으로 묶었고, Python 환경을 준비하는 단계가 없었다. 테스트 실행기가
`uv run`을 호출하면서 환경 준비와 테스트가 섞였다.

이제 다음처럼 나뉜다.

1. TOML 구조에서 pytest 의존성과 workspace 소속을 읽는다. 주석 속 `pytest`는
   의존성으로 세지 않는다. 공통 lock·관련 member manifest·Python pin을 함께 묶는다.
2. 승인된 별도 구현 공간에서만 uv를 오프라인으로 실행한다. 패키지 빌드,
   workspace package 설치, Python 다운로드, 온라인 재시도는 하지 않는다.
3. 준비가 실패하거나 준비 중 소스가 변하면 모델을 호출하지 않는다.
4. 테스트는 이미 준비된 환경으로 backend 폴더에서 실행한다. 테스트 실행 중
   의존성을 설치하지 않는다.

기존 Poetry·PDM 가상환경도 계속 쓸 수 있다. 다만 자동 설치는 지원하지 않는다.
여러 pytest 프로젝트나 중첩 workspace처럼 선택이 모호하면 확인을 요구한다.
workspace 라이브러리를 설치해야만 import되는 경우에도 이 준비만으로 충분하지 않다.

`doctor`도 실제 실행기와 같은 환경 위치를 보도록 맞췄다. 정상적인 가상환경의
Python 실행 파일 링크는 허용하지만, 환경 디렉터리 자체가 외부를 가리키면 거절한다.
**실행 파일이 있다는 판정은 라이브러리 import나 테스트 성공 판정이 아니다.**

## 실제 FastAPI에서 확인한 결과

대상은 공개 `fastapi/full-stack-fastapi-template`의
`fe3bafc6f6732698ed2c58424f64065a4209ad47`이다. 회사 저장소는 사용하지 않았다.

| 확인한 것 | 관찰 결과 |
|---|---|
| 실제 uv 준비 | 오프라인 준비 성공, registry 항목 76개·workspace 항목 1개, lock 변경 없음 |
| 실제 Python import | Python 3.12.13, FastAPI 0.115.14, pytest 7.4.4, SQLModel 0.0.31 |
| 제품이 생성한 실행기로 기존 전체 테스트 | **55개 실행, 52 통과·3 실패·0 error·0 skip** |
| 테스트 전후 소스 | fingerprint 동일 |
| `work` 준비 실패/소스 변경 경계 | 합성 경계 검사에서 두 경우 모두 모델 호출 0회 |
| 이번 실제 모델 호출 | **0회** |

첫 준비의 303ms는 이미 wheel이 캐시된 한 PC의 관찰이다. 새 PC 설치 시간이나
전체 구현 속도 개선 배율로 사용하지 않는다. 수정된 최종 코드로 준비 절차를
재실행한 결과도 별도로 남겼다. [실행·해시·환경 근거](artifacts/v32/python-execution.json).

원래 테스트는 수정하거나 제외하지 않았다. 남은 실패는 다음과 같다.

- 비밀번호 복구 1개: 합성 메일 발신자/전송 환경이 아직 완성되지 않아
  `emails_enabled` 조건에서 실패했다. 이것은 제품 구현 성공도, 원래 API 결함
  증명도 아니다.
- 사전 DB 연결 검사 2개: 원본 테스트가 `MagicMock.exec.called_once_with`를
  assertion처럼 사용한다. 이 Python에서는 유효한 mock assertion이 아니다.
  테스트의 연결 준비/patch 대상까지 검토해야 하므로 단순 이름 치환으로
  통과했다고 만들지 않았다.

이 기준선이 깨끗하지 않아 FastAPI의 유료 모델 비교는 시작하지 않았다.
`doctor`의 configuration readiness는 `ready`였지만, 실제 `check`는 위 세 실패를
정확히 실패로 남겼다. 두 판정을 같은 의미로 해석하면 안 된다.

## 임시 DB의 범위

별도의 공개 평가용 wrapper가 합성 설정을 넣고, digest가 고정된 캐시 이미지로
임시 PostgreSQL 16을 만들었다. pytest 시작 전에 dotenv 로딩을 끄고 실제
SQLModel 테이블을 생성한 뒤, 원래 conftest와 전체 테스트를 실행했다.
**Alembic migration 검증이 아니며, 일반 제품의 자동 DB 준비 기능도 아니다.**

읽기 전용 컨테이너·제한된 tmpfs·CPU/메모리/프로세스 수·임의 비밀번호를 사용했고,
호스트 파일 마운트나 영속 볼륨은 없었다. 실행 후 해당 작업 라벨의 컨테이너와
네트워크는 각각 0개였다. 조사용 공개 임시 clone과 의존성 캐시는 남겨 두었다.

Python socket 제한은 네이티브 드라이버까지 막는 OS egress 격리가 아니다.
Docker 20.10.17의 loopback 포트 게시도 완전한 호스트 격리로 주장하지 않는다.
회사 코드·실제 비밀값·운영 DB를 이 환경에 넣지 않았다.
이 PostgreSQL 사용은 공개 사례의 요구사항이며 **MySQL 우선 방향 변경이 아니다.**

## 다른 백엔드에 미친 영향도 확인했다

Python 실행기와 Jest 실행기는 공통 생성기를 쓴다. 전체 회귀에서 기존 Nest
평가용 실행기의 바이트가 달라졌다는 계약 검사가 실패했다. 검사 조건을 풀지 않고
실제 생성 결과로 fixture와 SHA-256을 갱신했다. 비교 protocol도
`python-workspace-v32`로 올려 과거 결과와 조용히 섞이지 않게 했다.

기존 Nest의 파일 매핑·Swagger 헤더·이메일 충돌 **3개 과제는 원래 코드에서
실패하고 정답 코드에서 통과하는 대조 검증을 다시 통과**했다. 별도로 시도한
session-update 과제는 공개 lockfile에 `gcp-metadata@7.0.1` 항목이 없어 준비에서
멈췄다. npm 10.1.0과 10.9.8 모두 같은 문제였으며, 테스트가 실행되지 않았으므로
통과로 세지 않는다. [성공 및 실패를 포함한 결과](artifacts/v32/nest-controls.json).

이것은 기존 대조 검사의 재확인이다. 이전 10/20 범위를 늘린 것도, 모델이
10개 과제를 해결했다는 뜻도 아니다. 나머지 Spring/FastAPI 대조 fixture와
판정기는 이번 변경에서 그대로 유지했다.

## QA와 다음 미완료 작업

- 전체 회귀 **504개: 500 통과, 0 실패, 4 건너뜀**.
- 줄 커버리지 **90.83%**, 분기 **81.79%**, 함수 **98.88%**.
- 선택한 mutation **25개 모두 탐지**. 전체 코드의 mutation 점수는 아니다.
- 문법, 설치된 패키지 실행, fixture hash, CLI 문서 계약 검증 통과.
- `npm audit --omit=dev`: 보고된 운영 의존성 취약점 0건. 무결점 보장은 아니다.

4개 skip은 opt-in MySQL, opt-in 실제 Maven/Gradle, 실제 Windows provider 실행,
실제 Windows 하위 프로세스 종료다. 이번에 실행했다고 주장하지 않는다.
[명령·해시·초기 실패·최종 수치](artifacts/v32/qa.json).

아직 해야 할 일은 FastAPI의 안전한 메일 테스트 환경과 원본 테스트 기준선을
명시적으로 정리하고, 같은 조건으로 실제 BTH/direct 구현을 비교하는 것이다.
서로 독립적인 3개 백엔드·20개 작업의 성공률, 규칙 위반, 시간·토큰·비용 비교가
끝나기 전에는 전체 목표가 완료됐다고 판정하지 않는다.

참고한 1차 자료: [uv workspace](https://docs.astral.sh/uv/concepts/projects/workspaces/),
[uv sync 정책](https://docs.astral.sh/uv/concepts/projects/sync/),
[smol-toml 소스](https://github.com/squirrelchat/smol-toml).

기존 프로젝트의 생성 파일은 자동 덮어쓰지 않는다. 버리는 복사본에서 새 계약을
생성해 diff를 확인한 뒤 팀 설정을 보존하며 옮겨야 한다. 이번 커밋은 소스 개선이며
npm 정식 버전 발행이 아니다.
