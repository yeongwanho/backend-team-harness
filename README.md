# Backend Team Harness

**서로 다른 백엔드 프로젝트에서 “완료했다”는 말을, 같은 소스에서 실제로 실행된 테스트와 재현 가능한 기록으로 바꾸는 로컬 하네스입니다.**

AI가 코드를 작성해도 좋고 사람이 직접 작성해도 좋습니다. BTH는 모델의 말로 PASS를 만들지 않습니다. Git 소스, 프로젝트가 선언한 명령, 방금 생성된 기계 판독 결과만 판정에 사용합니다.

## 한눈에 보는 구조

```text
개발자 또는 AI
      ↓
.backend-harness/verification.json     프로젝트가 실행 방법을 소유
      ↓
프로젝트 단위 잠금                     같은 build/report 동시 사용 차단
      ↓
argv Gate Runner                       shell 문자열·외부 실행 파일 거절
      ↓
┌──────────────────────┬─────────────────────────┐
│ EXECUTED             │ REPORTED                │
│ JUnit·프로세스 실행  │ 보안·정적분석·그래프    │
│ PASS 근거가 될 수 있음│ PASS를 만들 수 없음     │
└──────────────────────┴─────────────────────────┘
      ↓
Git + 입력 파일 + 도구체인 + 결과 해시 + redaction + append-only 이력
```

핵심 판정은 작고 보수적입니다.

```text
PASS = 모든 required Gate 통과
   AND required JUnit Gate 존재
   AND executed tests >= 각 Gate의 minimumTests
   AND failures = errors = 0
   AND 실행 전후 source fingerprint 동일

executed tests = 전체 testcase - skipped testcase
```

종료 코드 0, 오래된 XML, 모두 skip된 테스트, XML 속 가짜 태그, 분석 도구의 “문제 없음”만으로는 PASS가 되지 않습니다.

## 5분 시작

Node.js 20 이상이 필요합니다.

```bash
git clone https://github.com/yeongwanho/backend-team-harness.git
cd backend-team-harness
npm install
npm test

node src/cli.mjs init /path/to/backend-project
node src/cli.mjs doctor /path/to/backend-project
node src/cli.mjs check /path/to/backend-project
```

실제 실행 가능한 Gradle 예제도 포함합니다.

```bash
node src/cli.mjs doctor examples/spring-service
node src/cli.mjs check examples/spring-service --allow-network
```

`--allow-network`는 cold machine에서 Gradle Wrapper와 공개 의존성을 내려받는 프로젝트 Gate에 대한 명시적 승인입니다. 이것은 실행 의도를 확인하는 **승인 latch**이지 운영체제 방화벽이나 sandbox가 아닙니다. 프로젝트 실행 파일 자체가 악의적이면 선언 없이도 네트워크를 시도할 수 있으므로, 낯선 저장소는 Gate를 먼저 검토해야 합니다.

## 프로젝트 실행 계약

`bth init`은 Gradle/Maven Wrapper를 인식하면 `.backend-harness/verification.json`까지 만듭니다. 다른 빌드 시스템에서는 공용 지식 문서만 만들며, 아래 계약을 프로젝트의 실행 방식에 맞춰 직접 추가해야 합니다. 실행 Core는 프레임워크를 추측하지 않고 이 계약만 실행합니다.

```json
{
  "schemaVersion": 1,
  "context": {
    "profile": "test",
    "databaseDialect": "postgresql"
  },
  "gates": [
    {
      "id": "db-integration",
      "required": true,
      "network": true,
      "command": ["./gradlew", "integrationTest", "--no-daemon", "--rerun-tasks"],
      "inputs": ["gradle.properties", "gradle/wrapper/gradle-wrapper.properties", "gradle/wrapper/gradle-wrapper.jar"],
      "timeoutMs": 900000,
      "result": {
        "type": "junit",
        "reports": ["build/test-results/integrationTest/**/*.xml"],
        "minimumTests": 12
      }
    }
  ]
}
```

- `command[0]`은 프로젝트 안의 일반 실행 파일이어야 합니다.
- 명령은 argv 배열이며 `shell: false`로 실행됩니다.
- `inputs`는 Git에서 무시됐더라도 결과에 영향을 주는 파일을 내용 해시로 묶습니다.
- `network: true`인 Gate는 CLI의 명시적 `--allow-network` 없이는 실행되지 않습니다.
- 하나 이상의 required JUnit Gate가 반드시 있어야 합니다.
- `minimumTests`는 전체가 아니라 실제 실행된 테스트 수의 하한입니다.

자동 생성되는 JVM 기본값은 기존 캐시만 쓰는 `--offline` 모드입니다. 새 PC에서 의존성을 받아야 한다면 팀이 설정에서 `--offline`을 제거하고 `network: true`를 선언한 뒤, 해당 실행에만 `--allow-network`를 줍니다.

## 결과 계약 두 종류

| 결과 | 증거 등급 | 역할 |
| --- | --- | --- |
| `junit` | `EXECUTED` | fresh XML의 실행·실패·오류·skip을 판정하고 PASS 근거가 됨 |
| `exit-code` | `EXECUTED` | compile/migration 같은 프로세스 성공을 증명하지만 단독 PASS 불가 |
| `findings` | `REPORTED` | 보안·정적 분석 결과가 심각하면 PASS를 차단하지만 단독 PASS 불가 |
| `observation` | `REPORTED` | 그래프·coverage 같은 참고 정보. 항상 optional이며 PASS에 영향 없음 |

Findings 도구는 다음의 작은 JSON 계약으로 연결합니다.

```json
{
  "schemaVersion": 1,
  "tool": { "id": "scanner", "version": "1.2.3" },
  "findings": [
    {
      "ruleId": "security.secret",
      "severity": "high",
      "message": "Potential credential detected.",
      "location": { "path": "src/config.txt", "line": 3 }
    }
  ],
  "metrics": { "filesScanned": 42 }
}
```

## 설치형 Pack

Pack은 Core에 회사 정책을 박아 넣지 않고, 프로젝트가 소유할 Gate와 설명을 설치합니다.

```bash
node src/cli.mjs pack list
node src/cli.mjs pack install secrets-gitleaks /path/to/project
node src/cli.mjs pack install db-integration /path/to/project
node src/cli.mjs pack install architecture /path/to/project
node src/cli.mjs pack install contract /path/to/project
node src/cli.mjs pack install codegraph-advisory /path/to/project
```

| Pack | 무엇을 붙이나 | PASS 영향 |
| --- | --- | --- |
| `secrets-gitleaks` | 로컬 Gitleaks 결과를 비밀 본문 없이 Findings로 변환 | high/critical이면 차단, PASS 생성 불가 |
| `db-integration` | 같은 운영 dialect의 Testcontainers/Compose 통합테스트 Gate | 실행된 JUnit이므로 근거 가능 |
| `architecture` | ArchUnit/Spring Modulith `*ArchitectureTest` Gate | 실행된 JUnit이므로 근거 가능 |
| `contract` | Pact/SCC/OpenAPI/message contract Gate | 실행된 JUnit이므로 근거 가능 |
| `codegraph-advisory` | 명시적 import만 연결한 Java/Kotlin 탐색 그래프 | 참고 전용, PASS 영향 없음 |

설치는 기존 Gate id나 Pack 폴더를 덮어쓰지 않으며, 변경 전 `verification.json`을 로컬 backup에 보관합니다. DB·architecture·contract Pack은 프로젝트의 실제 task/profile/test를 팀이 구현해야 하며, 준비되지 않으면 fail-closed합니다. DB Pack은 Testcontainers 이미지나 의존성을 받을 수 있어 `network: true`로 설치되며 실행할 때 `--allow-network`가 필요합니다.

`bth doctor`의 `healthy`는 계약 파일·실행 파일·설정이 **구조적으로 실행 준비가 됐다**는 뜻입니다. 테스트 성공을 뜻하지 않습니다. 완료 근거는 반드시 `bth check` 또는 승인된 작업의 `bth verify` 결과로 만듭니다.

## DB는 어떻게 붙나

BTH가 모든 프로젝트에 두 번째 DB lifecycle을 강요하지 않습니다.

```text
프로젝트의 Testcontainers / Docker Compose / embedded DB
                         ↓
운영과 같은 dialect·관련 major version
                         ↓
empty DB migration + 필요한 upgrade path
                         ↓
프로젝트 integration tests → fresh JUnit → EXECUTED
```

운영 DB, 배포, 실제 비밀값은 기본 기능에 없습니다. SQLite에서 SQL 문자열 하나가 통과했다고 PostgreSQL migration이 안전하다고 주장하지 않습니다. Atlas 같은 SQL 분석기는 향후 project-owned Findings Gate로 추가할 수 있지만, 실제 dialect 통합테스트를 대체할 수 없습니다.

## 코드그래프의 정확한 위치

현재 그래프 Pack은 Java/Kotlin 파일, 선언된 type, 명시적 import만 인덱싱합니다. 모든 edge의 provenance는 `static-import-resolved`입니다.

포함하지 않는 것:

- 이름이 같다는 이유로 추측한 method call
- Spring runtime bean wiring
- reflection·동적 프록시
- SQL/table 소유권 추측
- 그래프 기반 테스트 생략

그래프 파일에는 `advisory: true`, 허용 용도(`navigation`, `review-questions`), 금지 용도(`pass-verdict`, `test-skipping`)가 함께 기록됩니다.

## 테스트 수 감소 방지

성공한 최신 실행의 Gate별 실행 수를 하한으로 올릴 수 있습니다.

```bash
node src/cli.mjs check /path/to/project
node src/cli.mjs baseline update /path/to/project
```

Baseline은 올리기만 하고 자동으로 낮추지 않습니다. 이후 테스트가 삭제·skip되어 실행 수가 줄면 Gate가 실패합니다.

## 팀 작업 상태가 필요할 때

매일 빠른 확인은 `bth check`만 사용합니다. 승인·인수인계가 필요한 변경은 task lifecycle을 사용합니다.

```text
CONTEXT_MISSING → CONTEXT_READY → PLAN_PROPOSED → PLAN_APPROVED
                                                       ↓
                                                IMPLEMENTING
                                                       ↓
                                                  VERIFYING
                                                ↙            ↘
                                      VERIFY_FAILED         VERIFIED → DONE
```

`bth verify`는 승인된 task만 실행합니다. `DONE` 직전에 소스 지문을 다시 계산하고 검증 이후 변경이 있으면 거절합니다.

## 기록과 보안

```text
.backend-harness/
├── verification.json
├── packs/
├── tasks/<id>/runs/latest.json
├── tasks/<id>/runs/history/*.json
├── tasks/<id>/evidence/              # local, Git ignored
└── local/runs/{latest.json,history/}  # local, Git ignored
```

기록에는 command argv, 프로세스 상태, 출력 byte/hash, fresh report 통계, 실행 파일 hash, Node/JDK/Wrapper 정보, 선언 profile/dialect, source fingerprint가 들어갑니다. stdout/stderr 원문은 공유 기록에서 제외합니다. 프로젝트·home·temp 절대경로와 일반적인 token/secret/credential 형태는 저장 전에 redaction합니다. JSON hash는 key 순서와 무관한 canonical serialization을 사용합니다.

이 도구는 악의적인 저장소를 격리하는 OS sandbox가 아닙니다. 프로젝트가 소유한 실행 파일은 신뢰 경계 안에 있으므로 실행 전 검토해야 합니다.

## OMO에서 참고한 것과 아닌 것

OMO 코드를 복사하거나 의존하지 않습니다. Core/adapter/project 경계, 명시적 상태, 실행 전 권한 Gate, evidence로 완료를 판정하는 일반 하네스 원칙을 백엔드 검증 문제에 맞게 독립 구현했습니다.

모델 라우팅, memory engine, lifecycle hook 수십 개, 다중 에이전트 runtime은 포함하지 않습니다. BTH의 목적은 “또 하나의 AI agent”가 아니라, 사람과 AI가 낸 백엔드 변경을 같은 방식으로 검증하는 것입니다.

더 자세한 문서:

- [Architecture](docs/ARCHITECTURE.md)
- [Evidence contract](docs/EVIDENCE-CONTRACT.md)
- [Pack guide](docs/PACKS.md)
- [OMO design mapping](docs/OMO-DESIGN-MAPPING.md)
- [Roadmap](docs/ROADMAP.md)
- [Security](SECURITY.md)

## License

[MIT](LICENSE). 번들된 Gradle Wrapper와 런타임 의존성 고지는 [Third-party notices](THIRD_PARTY_NOTICES.md)에 있습니다.
