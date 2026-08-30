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
┌──────────────────────┬─────────────────────────┬─────────────────────────┐
│ EXECUTED             │ REPORTED                │ CONTROL                 │
│ JUnit·프로세스 실행  │ 보안·정적분석·그래프    │ 실행 전 거부·도구 오류  │
│ PASS 근거가 될 수 있음│ PASS를 만들 수 없음     │ 실행 증거가 아님         │
└──────────────────────┴─────────────────────────┴─────────────────────────┘
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
    "databaseDialect": "mysql"
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

역사적인 경로명인 `.backend-harness/quality-gates/*.yaml`은 **사람이 계획·리뷰 때 확인할 체크리스트**입니다. `required: true`는 계획에서 반드시 다뤄야 한다는 뜻이지 자동 실행됐다는 뜻이 아닙니다. PASS를 차단하거나 만드는 실행 권한은 오직 `verification.json`에 선언된 Gate에 있습니다.

자동 생성되는 JVM 기본값은 기존 캐시만 쓰는 `--offline` 모드입니다. 새 PC에서 의존성을 받아야 한다면 팀이 설정에서 `--offline`을 제거하고 `network: true`를 선언한 뒤, 해당 실행에만 `--allow-network`를 줍니다.

### 실패를 더 빨리 보여 주는 선택적 순서 최적화

기본값은 언제나 작성된 Gate 순서입니다. 서로 선후 의존성이 없는 required Gate만 팀이 직접 표시하면, BTH가 로컬 실행 이력으로 실패 가능성과 평균 비용을 추정해 첫 실패를 더 빨리 보여 줄 수 있습니다.

```json
{
  "schemaVersion": 1,
  "scheduling": {
    "strategy": "adaptive-failure-first",
    "minimumObservations": 5,
    "priorFailures": 1,
    "priorPasses": 1
  },
  "gates": [
    { "id": "unit", "required": true, "reorderable": true, "command": ["./gradlew", "test"], "timeoutMs": 600000, "result": { "type": "junit", "reports": ["build/test-results/test/**/*.xml"], "minimumTests": 1 } },
    { "id": "integration", "required": true, "reorderable": true, "command": ["./gradlew", "integrationTest"], "timeoutMs": 900000, "result": { "type": "junit", "reports": ["build/test-results/integrationTest/**/*.xml"], "minimumTests": 1 } }
  ]
}
```

순서는 Beta 평활한 실패확률 `p`를 평균 시간 `c`로 나눈 `p/c` 내림차순입니다. 단, 다음 경계는 바뀌지 않습니다.

- `reorderable: true`가 없는 Gate는 이동하지 않습니다.
- required Gate가 연속된 구간 안에서만 이동합니다. fixed/optional Gate를 건너지 않습니다.
- 관측치가 부족하거나 이력이 없거나 손상됐으면 원래 순서로 돌아갑니다.
- PASS 경로에서는 모든 Gate가 정확히 한 번 실행됩니다. 이 기능은 테스트를 선택하거나 생략하지 않습니다.
- 이력은 순서에만 쓰이며 결과·증거 등급·테스트 수·source fingerprint·PASS에는 영향을 주지 못합니다.

결정적 benchmark fixture에서는 동일한 Gate를 유지하면서 첫 실패까지의 기대시간이 `1711.98 ms → 473.88 ms`, 즉 `3.61x` 개선됩니다. 이것은 명시된 독립 fail-fast 모형의 **제한된 알고리즘 지표**이지 실제 프로젝트 전체 속도나 OMO 대비 제품 성능 주장이 아닙니다.

```bash
npm run benchmark:adaptive
```

## 결과 계약과 증거 등급

| 결과 | 증거 등급 | 역할 |
| --- | --- | --- |
| `junit` | `EXECUTED` | fresh XML의 실행·실패·오류·skip을 판정하고 PASS 근거가 됨 |
| `exit-code` | `EXECUTED` | compile/migration 같은 프로세스 성공을 증명하지만 단독 PASS 불가 |
| `findings` | `REPORTED` | 보안·정적 분석 결과가 심각하면 PASS를 차단하지만 단독 PASS 불가 |
| `observation` | `REPORTED` | 그래프·coverage 같은 참고 정보. 항상 optional이며 PASS에 영향 없음 |
| 실행 전 거부·도구 오류 | `CONTROL` | 안전장치와 실패 경로의 기록. 프로젝트 동작을 실행했다는 증거가 아님 |

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

0.7에서 0.8로 올릴 때 기존 Pack Gate가 기본 test와 같은 report 폴더를 쓰고 있다면 먼저 Gate별 전용 폴더로 옮겨야 합니다. Gradle은 `build/test-results/<gate>/`, Maven은 `target/bth-reports/<gate>/` 형태를 권장합니다. 0.8은 겹치는 glob과 프로젝트 루트 report를 거절하며, 실행 전 정리할 기존 report도 Git에 추적되지 않고 `.gitignore`에 포함된 파일만 허용합니다. `architecture` Pack의 두 Gradle snippet은 `*ArchitectureTest`를 기본 `test`에서 제외해 중복 실행도 막습니다.

구조화된 report는 파일당 16 MiB, 한 수집 단계 전체 64 MiB로 제한되고 한 파일씩 읽어 합산됩니다. 전용 report 트리 안의 심볼릭 링크는 실행 전에 거절합니다. 번들 Pack도 compact JSON을 원자적으로 교체하며, report 디렉터리가 프로젝트 밖으로 연결되면 쓰지 않습니다. 이 경계는 대규모 결과의 메모리 폭증과 report 경로를 이용한 외부 파일 덮어쓰기를 함께 막습니다.

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

현재 참조 구현은 MySQL 8.4 LTS를 기준으로 합니다. 예제는 고정된 `mysql:8.4.11` 이미지를 사용해 Flyway migration, MySQL `JSON`·`ENUM`·`utf8mb4`, 실제 JDBC 왕복, 실패·시간초과 뒤 컨테이너 정리를 검증합니다. Core는 MySQL에 종속되지 않지만, 지금 DB Pack의 첫 번째 실전 지원 경로는 MySQL입니다.

운영 DB, 배포, 실제 비밀값은 기본 기능에 없습니다. H2나 SQLite에서 SQL 문자열 하나가 통과했다고 MySQL migration이 안전하다고 주장하지 않습니다. Atlas 같은 SQL 분석기는 향후 project-owned Findings Gate로 추가할 수 있지만, 실제 MySQL 통합테스트를 대체할 수 없습니다.

## 코드그래프의 정확한 위치

현재 그래프 Pack은 Java/Kotlin 파일, 선언된 type, 명시적 import만 인덱싱합니다. 모든 edge의 provenance는 `static-import-resolved`입니다.

포함하지 않는 것:

- 이름이 같다는 이유로 추측한 method call
- Spring runtime bean wiring
- reflection·동적 프록시
- SQL/table 소유권 추측
- 그래프 기반 테스트 생략

그래프 파일에는 `advisory: true`, 허용 용도(`navigation`, `review-questions`), 금지 용도(`pass-verdict`, `test-skipping`)가 함께 기록됩니다. 두 권한 목록은 각각 최대 16개의 짧은 식별자로 제한되어 작은 context budget을 우회해 응답을 부풀릴 수 없습니다. 생성 파일은 loader와 같은 16 MiB 상한을 넘으면 생성 단계에서 실패합니다.

그래프 Pack이 현재 소스에 묶인 성공한 observation을 만들었다면, 승인된 계획을 내보낼 때 요구사항에 맞는 코드 위치를 제한된 예산 안에서 함께 받을 수 있습니다.

```bash
node src/cli.mjs task export-plan USER-17 /path/to/project \
  --context-budget 4000 --json
```

BTH는 요구사항의 단어를 path/type과 대조하고, exact import edge 위에서 bounded Personalized PageRank를 계산합니다. 결과에는 점수뿐 아니라 사용한 문자 수, 누락된 node 수, graph 생성값, edge provenance와 알려진 한계가 들어갑니다. 그래프가 없거나 오래됐거나 run record와 digest가 다르면 계획 export는 실패하지 않고 `codeContext.status: "unavailable"`과 이유를 돌려줍니다.

## 테스트 수 감소 방지

성공한 최신 실행의 Gate별 실행 수를 하한으로 올릴 수 있습니다.

```bash
node src/cli.mjs check /path/to/project
node src/cli.mjs baseline update /path/to/project
```

Baseline은 올리기만 하고 자동으로 낮추지 않습니다. 이후 테스트가 삭제·skip되어 실행 수가 줄면 Gate가 실패합니다.

## 팀 작업 상태가 필요할 때

매일 빠른 확인은 `bth check`만 사용합니다. 승인·인수인계가 필요한 변경은 task lifecycle을 사용합니다.

요구사항이 아직 실행 가능한 계획이 아니라면 BTH의 내장 인터뷰로 시작할 수 있습니다. 이것은 Ouroboros·Gajae·OMO를 호출하는 래퍼가 아니라 BTH Core 안의 결정적 상태 기계입니다.

```bash
node src/cli.mjs interview start USER-17 /path/to/project \
  --requirement "사용자 ID 조회 API에 안전한 not-found 응답을 추가한다" \
  --by developer

# 명령이 보여 주는 현재 질문 하나에 답합니다.
node src/cli.mjs interview answer USER-17 /path/to/project \
  --question acceptance \
  --text "존재하면 200, 없으면 기존 오류 계약의 404를 반환한다" \
  --by developer

# scope → data → verification → constraints도 같은 방식으로 답합니다.
# 이미 답한 결정은 다른 답을 잃지 않고 고칠 수 있습니다.
node src/cli.mjs interview revise USER-17 /path/to/project \
  --question scope --text "users 모듈과 관련 테스트만 변경" --by reviewer

# 인터뷰 도중 소스가 바뀌었다면 답을 보존한 채 현재 Git 상태에 다시 묶습니다.
node src/cli.mjs interview rebind USER-17 /path/to/project --by developer

node src/cli.mjs interview finalize USER-17 /path/to/project --by developer
```

인터뷰 시작 시 BTH는 Git 지문, 빌드 정의, 소스·테스트 수, Flyway, DB dialect, 품질 정책, `verification.json` Gate를 읽기 전용으로 수집합니다. 질문은 완료 조건·변경 범위·DB 영향·검증·제약의 다섯 가지이며, 한 번에 현재 질문 하나만 답할 수 있습니다. 질문의 힌트는 감지한 MySQL/Flyway/Gate 사실을 보여 주지만 답을 대신 채우지는 않습니다. 확정되지 않은 답은 `--status unknown` 또는 `--status conflict`로 남길 수 있지만 해결 전에는 계획을 확정하지 못합니다.

`finalize`는 다음 파일을 만듭니다.

```text
.backend-harness/tasks/USER-17/interview/
├── events.jsonl              # hash-chain 감사 이력
├── context-snapshot.json     # 결정적으로 관찰한 프로젝트 사실
├── context-snapshots/<sha>.json # 재바인딩해도 남는 불변 스냅샷
├── requirement.json
├── context.json
├── impact.json
├── plan.json
└── plan.md                   # 사람이 검토하는 실행계획
```

계획 확정 중 Git 소스가 바뀌면 실패합니다. `interview rebind`를 해야 새 프로젝트 사실을 다시 수집하고 기존 답을 새 소스에 묶을 수 있습니다. 확정 후 task는 `PLAN_PROPOSED`가 되며 자동 승인되지 않습니다. 사람은 내용을 검토한 뒤 아래처럼 승인합니다. 승인 시 소스 지문뿐 아니라 canonical `plan.json` SHA-256까지 검증하고, context/plan/artifact 해시가 든 승인 영수증을 task 이력에 남깁니다.

```bash
node src/cli.mjs task advance USER-17 PLAN_APPROVED /path/to/project --by reviewer --approve
# 어떤 코딩 에이전트에도 넘길 수 있는 읽기 전용 JSON 계약
node src/cli.mjs task export-plan USER-17 /path/to/project --json
node src/cli.mjs task advance USER-17 IMPLEMENTING /path/to/project --by developer
# 사람 또는 연결된 코딩 에이전트가 승인된 plan.md 범위만 구현
node src/cli.mjs verify USER-17 /path/to/project
# 실패했다면 sealed run record에서 Gate·테스트·재실행 명령을 설명
node src/cli.mjs diagnose USER-17 /path/to/project
```

BTH 자체가 모델을 내장하거나 임의로 코드를 수정하지는 않습니다. 그래서 어떤 코딩 에이전트나 사람과도 함께 쓸 수 있고, 계획·승인·검증 판정은 모델의 주장과 분리됩니다.

```text
CONTEXT_MISSING → CONTEXT_READY → PLAN_PROPOSED → PLAN_APPROVED
                                                       ↓
                                                IMPLEMENTING
                                                       ↓
                                                  VERIFYING
                                                ↙            ↘
                                      VERIFY_FAILED         VERIFIED → DONE
```

`task export-plan`은 모델에 종속되지 않은 입력 포트이며 코드 쓰기 권한이나 완료 판정 권한을 주지 않습니다. `bth verify`는 승인된 task만 실행합니다. 실패는 `diagnose`가 최신 sealed run record에서 설명하지만 자동으로 PASS로 바꾸거나 실패 기록을 숨기지 않습니다. `DONE` 직전에 소스 지문을 다시 계산하고 검증 이후 변경이 있으면 거절합니다.

## 기록과 보안

```text
.backend-harness/
├── verification.json
├── packs/
├── tasks/<id>/interview/              # source-bound requirement/context/impact/plan
├── tasks/<id>/runs/latest.json
├── tasks/<id>/runs/history/*.json
├── tasks/<id>/evidence/              # local, Git ignored
├── local/runs/{latest.json,history/}  # local, Git ignored
└── local/optimization/gate-history.json # aggregate only, Git ignored
```

기록에는 command argv, 프로세스 상태, 출력 byte/hash, 새로 생성된 report 통계, 실행 파일 hash, Node/JDK/Wrapper 정보, 선언 profile/dialect, source fingerprint가 들어갑니다. Gate 실행 전에는 그 Gate 전용 폴더의 이전 structured report를 제거하므로, 오래된 XML을 `touch`해서 새 증거처럼 만들 수 없습니다. 이 정리는 Git에 추적되거나 ignore되지 않은 파일을 만나면 삭제하지 않고 실패합니다. stdout/stderr 원문은 공유 기록에서 제외합니다. 프로젝트·home·temp 절대경로와 일반적인 token/secret/credential 형태는 저장 전에 redaction합니다. JSON hash는 key 순서와 무관한 canonical serialization을 사용합니다.

상세 `tasks/<id>/evidence/`는 로컬에만 남습니다. 팀 인수인계에는 redaction·seal된 `tasks/<id>/runs/latest.json`을 커밋할 수 있습니다. 다른 clone에서 이미 `VERIFIED`인 task를 `DONE`으로 옮길 때만 이 요약을 대체 근거로 사용하며, task/evidence id, `EXECUTED` PASS, record seal, 안정된 pre/post source fingerprint, 1개 이상의 실행 test, 모든 required Gate 통과를 확인합니다. `VERIFYING -> VERIFIED`는 로컬 상세 evidence가 필요합니다. 이 seal은 실수·손상을 잡는 협업용 무결성이지 신뢰된 CI의 전자서명이 아닙니다. 저장소와 실행 기록을 모두 통제하는 악의적인 작성자까지 증명하려면 별도의 신뢰된 CI 서명/attestation이 필요합니다.

이 도구는 악의적인 저장소를 격리하는 OS sandbox가 아닙니다. 프로젝트가 소유한 실행 파일은 신뢰 경계 안에 있으므로 실행 전 검토해야 합니다.

## OMO에서 참고한 것과 아닌 것

OMO 코드를 복사하거나 의존하지 않습니다. Core/adapter/project 경계, 명시적 상태, 실행 전 권한 Gate, evidence로 완료를 판정하는 일반 하네스 원칙을 백엔드 검증 문제에 맞게 독립 구현했습니다.

모델 라우팅, memory engine, lifecycle hook 수십 개, 다중 에이전트 runtime은 포함하지 않습니다. BTH의 목적은 “또 하나의 AI agent”가 아니라, 사람과 AI가 낸 백엔드 변경을 같은 방식으로 검증하는 것입니다.

더 자세한 문서:

- [Architecture](docs/ARCHITECTURE.md)
- [Evidence contract](docs/EVIDENCE-CONTRACT.md)
- [Pack guide](docs/PACKS.md)
- [OMO design mapping](docs/OMO-DESIGN-MAPPING.md)
- [2026 adaptive harness research](docs/RESEARCH-2026-ADAPTIVE-HARNESS.md)
- [Roadmap](docs/ROADMAP.md)
- [Security](SECURITY.md)

## License

[MIT](LICENSE). 번들된 Gradle Wrapper와 런타임 의존성 고지는 [Third-party notices](THIRD_PARTY_NOTICES.md)에 있습니다.
