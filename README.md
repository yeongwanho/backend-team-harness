# Backend Team Harness

**백엔드 변경을 “어떤 소스에서 무엇을 실행했고 실제 테스트가 몇 개 통과했는가”로 확인하는 로컬 검증 하네스입니다.**

현재 버전은 AI 모델을 호출하지 않습니다. 개발자나 AI가 코드를 작성할 수는 있지만, 완료 판정은 Git 소스 지문, 프로젝트가 선언한 명령, 새로 생성된 JUnit 결과로만 결정합니다.

## 왜 필요한가

`테스트했어요`라는 말만으로는 다음을 알 수 없습니다.

- 검증 뒤에 코드가 바뀌지 않았는가
- 테스트가 실제로 실행됐는가, 0개였는가
- Gradle 단위 테스트만 돌고 Maven 통합 테스트는 빠지지 않았는가
- 다른 개발자가 같은 조건으로 다시 실행할 수 있는가

Backend Team Harness는 이 간격을 줄입니다.

```text
Git source binding
        ↓
project-declared gates
        ↓
fresh JUnit reports
        ↓
tests > 0 and failures = errors = 0
        ↓
local/shared run record
```

SHA-256은 실행 결과를 진실로 만드는 서명이 아닙니다. 입력을 식별하고 우연한 변경을 탐지하는 지문입니다. 신뢰의 최종 근거는 실행 기록에 포함된 명령을 같은 소스에서 다시 실행하는 것입니다.

## 현재 실제로 되는 것

- Git commit, tracked diff, untracked content를 묶어 소스 지문을 만듭니다.
- 실행 중 바뀌는 하네스의 task·local·generated 파일은 소스 지문에서 제외합니다.
- 프로젝트가 소유한 실행 파일과 인자 배열만 실행합니다. 셸 문자열은 받지 않습니다.
- 여러 필수·선택 Gate를 순서대로 실행하고 필수 Gate 실패 시 이후 실행을 중단합니다.
- Gradle 기본값은 캐시 결과를 재사용하지 않도록 `--rerun-tasks`를 사용합니다.
- Maven 기본값은 Failsafe 통합 테스트까지 포함하도록 `verify`를 사용합니다.
- 현재 실행에서 새로 생성되거나 변경된 JUnit XML만 인정합니다.
- 테스트 0개, 누락·오래된 보고서, 실패, 오류, timeout, signal을 모두 실패로 판정합니다.
- timeout 시 POSIX 프로세스 그룹을 종료해 자식 프로세스가 남는 것을 막습니다.
- stdout/stderr 원문 대신 크기와 SHA-256을 기록합니다.
- `bth check`는 매일 쓰는 로컬 실행 기록을 남깁니다.
- 승인된 작업의 `bth verify`는 Git에 공유할 수 있는 `runs/latest.json`을 남깁니다.
- 검증 뒤 소스가 바뀌면 `DONE` 전이를 거절합니다.

## 5분 사용법

Node.js 20 이상이 필요하며 런타임 npm 의존성은 없습니다.

```bash
git clone https://github.com/yeongwanho/backend-team-harness.git
cd backend-team-harness
npm test

bth init /path/to/backend-project
bth doctor /path/to/backend-project
bth check /path/to/backend-project
```

Gradle 또는 Maven 빌드 파일이 있으면 `init`이 `.backend-harness/verification.json` 기본값을 생성합니다. 다른 언어·프레임워크는 프로젝트가 가진 테스트 명령과 JUnit 출력 경로를 적으면 됩니다.

## 실행 설정

```json
{
  "schemaVersion": 1,
  "gates": [
    {
      "id": "migration",
      "required": true,
      "command": ["./scripts/verify-migrations"],
      "timeoutMs": 120000,
      "result": { "type": "exit-code" }
    },
    {
      "id": "tests",
      "required": true,
      "command": ["./gradlew", "test", "--offline", "--no-daemon", "--console=plain", "--rerun-tasks"],
      "timeoutMs": 600000,
      "result": {
        "type": "junit",
        "reports": ["build/test-results/**/*.xml"],
        "minimumTests": 1
      }
    }
  ]
}
```

규칙은 의도적으로 작습니다.

- `command[0]`은 프로젝트 내부의 일반 실행 파일이어야 합니다.
- 절대 경로, `..`, 심볼릭 링크 실행 파일은 거절합니다.
- 하나 이상의 필수 JUnit Gate가 있어야 합니다.
- `exit-code` Gate만으로 `VERIFIED`를 만들 수 없습니다.
- 설정된 명령은 신뢰한 저장소의 코드입니다. 이 도구는 운영체제 sandbox가 아닙니다.

## DB 검증 연결

하네스가 모든 프로젝트의 DB를 독점적으로 생성하지 않습니다. 프로젝트가 이미 사용하는 방식을 Gate로 연결합니다.

```text
Testcontainers / Docker Compose / embedded DB
                     ↓
       project-owned migration script
                     ↓
      migration gate + integration-test gate
```

프로젝트에 DB 준비 방식이 없다면 별도 스크립트나 향후 DB Pack을 추가할 수 있습니다. 운영 DB, 배포, 비밀 읽기는 기본 기능에 포함하지 않습니다.

## 팀 작업 흐름

간단한 로컬 반복은 `bth check`만 사용합니다. 리뷰 가능한 작업 상태가 필요할 때 다음 흐름을 사용합니다.

```bash
bth task create ORDER-123 /path/to/project \
  --title "주문 상태 조회 추가" \
  --context "요구사항과 확인할 출처"
bth task advance ORDER-123 CONTEXT_READY /path/to/project --by developer
bth task plan ORDER-123 /path/to/project --text "변경·테스트·위험 계획" --by developer
bth task advance ORDER-123 PLAN_PROPOSED /path/to/project --by developer
bth task advance ORDER-123 PLAN_APPROVED /path/to/project --by reviewer --approve
bth task advance ORDER-123 IMPLEMENTING /path/to/project --by developer
bth verify ORDER-123 /path/to/project
bth task advance ORDER-123 DONE /path/to/project --by developer
```

```text
CONTEXT_MISSING → CONTEXT_READY → PLAN_PROPOSED → PLAN_APPROVED
                                                       ↓
                                                IMPLEMENTING
                                                       ↓
                                                  VERIFYING
                                                ↙            ↘
                                      VERIFY_FAILED         VERIFIED → DONE
```

## 생성되는 구조

```text
.backend-harness/
├── verification.json          # 실제 실행 Gate와 결과 규칙
├── project.md                 # 서비스 목적과 범위
├── architecture.md            # 모듈·데이터·런타임 경계
├── glossary.md                # 팀 용어
├── policies/                  # API·DB·보안·오류 정책
├── workflows/                 # 사람이 읽는 작업 절차
├── quality-gates/             # 검토 체크리스트 스키마
├── tasks/<id>/
│   ├── task.md
│   ├── task.json
│   ├── events.jsonl
│   ├── runs/latest.json       # 공유 가능한 검증 요약
│   └── evidence/              # 로컬 상세 레코드, Git 제외
└── local/runs/latest.json     # bth check 결과, Git 제외
```

## 범용성

Core는 Gradle·Maven·Spring을 모릅니다. 프로젝트별 차이는 `verification.json`과 프로젝트 소유 실행 파일에 있습니다. 테스트에는 Gradle 형태 프로젝트와 실제 Node 테스트 러너를 사용하는 비-Java 프로젝트가 모두 포함됩니다.

새로운 생태계를 지원하기 위해 Core Adapter를 추가하는 대신 다음만 맞추는 것이 기본 원칙입니다.

1. 프로젝트 내부 실행 파일
2. 명령 인자 배열
3. JUnit XML 결과 위치

## 현재 범위와 다음 단계

구현됨:

- [x] 안전한 초기화와 doctor
- [x] 작업 상태·승인·이벤트 재생
- [x] Git source binding
- [x] 범용 Gate 실행기
- [x] JUnit/Surefire/Failsafe 결과 집계
- [x] 테스트 0개·stale report 차단
- [x] 로컬·공유 실행 기록
- [x] 검증 후 소스 변경 차단
- [x] 실제 Maven·Gradle·Node 테스트 러너 E2E

아직 주장하지 않는 것:

- Code Graph 또는 변경 영향 기반 테스트 생략
- 모든 프로젝트의 DB lifecycle 자동 관리
- AI 모델·다중 에이전트·메모리 엔진
- CI, 배포 플랫폼, 운영 DB 클라이언트
- 악의적인 저장소를 격리하는 OS sandbox

Code Graph는 검증의 전제 조건이 아닙니다. 실제 실행에서 수집한 coverage·SQL·테이블 관계가 필요해진 뒤 관측 기반 인덱스로 검토합니다. 그래프가 PASS 판정기가 되지는 않습니다.

## OMO에서 참고한 범위

OMO 코드를 복사하거나 의존하지 않습니다. Core/프로젝트 경계, 명시적 상태, Tool 실행 전 Gate, 실행 기록으로 완료를 판정하는 원칙을 백엔드 검증 문제에 맞게 독립 구현했습니다. 다중 에이전트, memory, 모델 라우팅, lifecycle hook 시스템은 포함하지 않습니다.

자세한 내용:

- [Architecture](docs/ARCHITECTURE.md)
- [OMO Design Mapping](docs/OMO-DESIGN-MAPPING.md)
- [Roadmap](docs/ROADMAP.md)
- [Security](SECURITY.md)

## License

[MIT](LICENSE)
