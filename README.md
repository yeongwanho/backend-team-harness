# Backend Team Harness

**서로 다른 백엔드 프로젝트에서 “완료했다”는 말을, 같은 소스에서 실제로 실행된 테스트와 재현 가능한 기록으로 바꾸는 로컬 하네스입니다.**

AI가 코드를 작성해도 좋고 사람이 직접 작성해도 좋습니다. BTH는 모델의 말로 PASS를 만들지 않습니다. Git 소스, 프로젝트가 선언한 명령, 방금 생성된 기계 판독 결과만 판정에 사용합니다.

## 한눈에 보는 구조

```text
개발자 또는 AI
      ↓
.backend-harness/project-rules.json   Git·정책·코드·DB 사실의 3값 제약 검사
.backend-harness/project-facts.json   회사·프로젝트가 소유하는 출처 결합 사실
      ↓
요구사항 인터뷰 → 모순/unknown 해소 → source-bound 계획 → 사람 승인
      ↓
.backend-harness/implementation.json  선택적 격리 구현 어댑터 + 쓰기 예산
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
npm ci
npm test
npm link

bth init /path/to/backend-project
# 저장소가 Gradle과 Maven을 함께 제공할 때만 명시적으로 하나를 선택
bth init /path/to/backend-project --build maven
bth doctor /path/to/backend-project
bth intelligence inspect /path/to/backend-project
bth check /path/to/backend-project
```

`init`이 만든 `.backend-harness/` 계약은 팀이 검토하고 Git에 커밋해야 합니다. Codex 또는 Claude를 한 번 연결한 뒤에는 긴 수동 명령 열 대신 `work`로 시작합니다.

```bash
bth implement configure codex /path/to/backend-project \
  --mode auto --allowed-prefixes '["src/","build.gradle.kts"]'

# 첫 호출: 규칙·인접 코드·영향 범위를 읽고 계획 또는 꼭 필요한 질문만 출력
bth work "기존 응답과 호환되는 사용자 상태 조회 API를 추가한다. DB 변경은 없다." \
  /path/to/backend-project --id USER-17 --by developer

# 계획을 검토한 뒤에만: 격리 구현 → 변경 경로용 빠른 Gate → 전체 필수 Gate
bth work "기존 응답과 호환되는 사용자 상태 조회 API를 추가한다. DB 변경은 없다." \
  /path/to/backend-project --id USER-17 --by developer \
  --approve --run --allow-write --acknowledge-network-risk

# 통과한 후보 diff를 검토한 뒤 원본 작업 트리에 명시적으로 반영
bth implement apply USER-17 /path/to/backend-project --by developer --allow-write
```

질문이 남으면 출력된 decision id만 `--decisions` JSON으로 다시 전달합니다. 작은 CRUD도 규칙 탐색을 생략하지 않지만, 관련 경로용 feedback Gate가 먼저 실패하면 넓은 전체 테스트를 쓰지 않고 즉시 복구합니다. 선택된 feedback이 전체 Gate와 같으면 같은 테스트를 두 번 실행하지 않고 전체 검증을 한 번만 실행합니다. 최종 성공 판정은 항상 전체 required Gate를 통과해야 합니다.

DB 구조를 바꾸는데 기존 변경 이력이 확인되지 않으면, **기존 DB를 업그레이드할지 / 새 빈 DB의 초기화 코드만 바꿀지** 먼저 묻습니다. `--decisions` JSON의 `schemaStrategy`에 `migration` 또는 `bootstrap-only`를 넣습니다. 초기화만 선택해도 승인·프로젝트 규칙·테스트는 생략하지 않으며, 기존 데이터의 업그레이드가 검증됐다고 기록하지 않습니다.

실제 실행 가능한 Gradle 예제도 포함합니다.

```bash
node src/cli.mjs doctor examples/spring-service
node src/cli.mjs check examples/spring-service --acknowledge-network-risk
```

`--acknowledge-network-risk`는 cold machine에서 Gradle Wrapper와 공개 의존성을 내려받을 수 있는 프로젝트 Gate의 위험을 사용자가 확인했다는 기록입니다. 이것은 실행 의도를 확인하는 **위험 승인 latch**이지 운영체제 방화벽이나 sandbox가 아닙니다. 프로젝트 실행 파일 자체가 악의적이면 선언 없이도 네트워크를 시도할 수 있으므로, 낯선 저장소는 Gate를 먼저 검토해야 합니다. 예전 `--allow-network` 이름은 호환 목적으로만 허용되며 경고를 출력합니다.

## 프로젝트 실행 계약

`bth init`은 Gradle/Maven Wrapper 또는 저장소가 선언한 고유한 Jest·Vitest·Pytest 구성을 인식하면 `.backend-harness/verification.json`과 OS별 프로젝트 전용 실행 래퍼까지 만듭니다. Gradle과 Maven을 의도적으로 함께 제공하는 저장소는 `--build gradle|maven`으로 팀의 선택을 명시할 수 있고, 이후 `doctor`도 생성된 검증 명령에서 그 선택을 다시 읽습니다. 여러 테스트 프로젝트가 충돌하거나 지원되지 않는 빌드라면 하나를 임의 선택하지 않고 팀이 아래 계약을 직접 정하도록 멈춥니다. 검증 자체는 Node의 프로젝트 `node_modules`, Python의 프로젝트 `.venv` 또는 `uv run --offline`만 사용하며 설치나 네트워크를 자동으로 켜지 않습니다. 별도로 npm lock이 있는 Jest·Vitest 프로젝트는 **승인된 격리 구현에만** 아래의 오프라인 의존성 준비 계약을 생성합니다. `init` 자체는 설치하지 않습니다.

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
- `network: true`인 Gate는 CLI의 명시적 `--acknowledge-network-risk` 없이는 실행되지 않습니다.
- `dependsOn`은 선행 Gate가 통과하기 전 실행을 막습니다. 필수 Gate가 선택적 observation에 의존하는 구성은 거절됩니다.
- 하나 이상의 required JUnit Gate가 반드시 있어야 합니다. 여기서 JUnit은 JVM 전용이라는 뜻이 아니라 Jest·Vitest·Pytest 결과도 같은 엄격한 testcase 계약으로 직렬화한다는 뜻입니다.
- `minimumTests`는 전체가 아니라 실제 실행된 테스트 수의 하한입니다.

역사적인 경로명인 `.backend-harness/quality-gates/*.yaml`은 **사람이 계획·리뷰 때 확인할 체크리스트**입니다. `required: true`는 계획에서 반드시 다뤄야 한다는 뜻이지 자동 실행됐다는 뜻이 아닙니다. PASS를 차단하거나 만드는 실행 권한은 오직 `verification.json`에 선언된 Gate에 있습니다.

자동 생성되는 JVM 기본값은 기존 캐시만 쓰는 `--offline` 모드입니다. portable 기본값도 설치된 프로젝트 로컬 런타임 또는 `uv --offline`만 허용합니다. 새 PC에서 의존성을 받아야 한다면 하네스 밖에서 먼저 설치하거나, 팀이 Gate에서 네트워크 필요성을 명시적으로 선언하고 해당 실행에만 `--acknowledge-network-risk`를 줍니다.

### 실패를 더 빨리 보여 주는 선택적 순서 최적화

기본값은 언제나 작성된 Gate 순서입니다. 팀이 required Gate를 직접 `reorderable`로 표시하면, BTH가 로컬 실행 이력으로 실패 가능성과 평균 비용을 추정해 첫 실패를 더 빨리 보여 줄 수 있습니다.

```json
{
  "schemaVersion": 1,
  "scheduling": {
    "strategy": "adaptive-failure-first",
    "minimumObservations": 5,
    "priorFailures": 1,
    "priorPasses": 1,
    "maxParallel": 2
  },
  "gates": [
    { "id": "unit", "required": true, "reorderable": true, "parallelSafe": true, "resourceClass": "unit-jvm", "command": ["./gradlew", "test"], "timeoutMs": 600000, "result": { "type": "junit", "reports": ["build/test-results/test/**/*.xml"], "minimumTests": 1 } },
    { "id": "integration", "required": true, "reorderable": true, "dependsOn": ["unit"], "command": ["./gradlew", "integrationTest"], "timeoutMs": 900000, "result": { "type": "junit", "reports": ["build/test-results/integrationTest/**/*.xml"], "minimumTests": 1 } }
  ]
}
```

의존성이 없는 직렬 구간은 Beta 평활한 실패확률 `p`를 평균 시간 `c`로 나눈 `p/c` 내림차순이 pairwise optimum입니다. 의존성이 있는 18개 이하의 직렬 구간은 `duration + passProbability × remainingCost` 점화식의 동적계획법으로 가능한 위상 순서 중 기대 실패 피드백 시간이 가장 짧은 순서를 정확히 구합니다. 병렬 구간이나 더 큰 DAG는 안전한 ready-set 휴리스틱으로 표시하며 전역 최적이라고 주장하지 않습니다. 다음 경계는 항상 유지됩니다.

- `reorderable: true`가 없는 Gate는 이동하지 않습니다.
- required Gate가 연속된 구간 안에서만 이동하며 `dependsOn`의 ready-set을 절대 추월하지 않습니다. fixed/optional Gate도 건너지 않습니다.
- 기본 병렬도는 1입니다. `parallelSafe: true`이고 서로 다른 `resourceClass`를 선언한 ready Gate만 `maxParallel` 한도에서 동시에 실행됩니다.
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
| `codegraph-advisory` | JVM·TypeScript/JavaScript·Python의 보수적 정적 관계와 SQL·설정·템플릿의 경로 전용 artifact를 연결한 구조 그래프 | 참고 전용, PASS 영향 없음 |

설치는 기존 Gate id나 Pack 폴더를 덮어쓰지 않으며, 변경 전 `verification.json`을 로컬 backup에 보관합니다. DB·architecture·contract Pack은 프로젝트의 실제 task/profile/test를 팀이 구현해야 하며, 준비되지 않으면 fail-closed합니다. DB Pack은 Testcontainers 이미지나 의존성을 받을 수 있어 `network: true`로 설치되며 실행할 때 `--acknowledge-network-risk`가 필요합니다.

0.7에서 0.8로 올릴 때 기존 Pack Gate가 기본 test와 같은 report 폴더를 쓰고 있다면 먼저 Gate별 전용 폴더로 옮겨야 합니다. Gradle은 `build/test-results/<gate>/`, Maven은 `target/bth-reports/<gate>/` 형태를 권장합니다. 0.8은 겹치는 glob과 프로젝트 루트 report를 거절하며, 실행 전 정리할 기존 report도 Git에 추적되지 않고 `.gitignore`에 포함된 파일만 허용합니다. `architecture` Pack의 두 Gradle snippet은 `*ArchitectureTest`를 기본 `test`에서 제외해 중복 실행도 막습니다.

구조화된 report는 파일당 16 MiB, 한 수집 단계 전체 64 MiB로 제한되고 한 파일씩 읽어 합산됩니다. 전용 report 트리 안의 심볼릭 링크는 실행 전에 거절합니다. 번들 Pack도 compact JSON을 원자적으로 교체하며, report 디렉터리가 프로젝트 밖으로 연결되면 쓰지 않습니다. 이 경계는 대규모 결과의 메모리 폭증과 report 경로를 이용한 외부 파일 덮어쓰기를 함께 막습니다.

`bth doctor`의 `healthy`는 계약 파일·실행 파일·설정이 **구조적으로 실행 준비가 됐다**는 뜻입니다. 테스트 성공을 뜻하지 않습니다. 완료 근거는 반드시 `bth check` 또는 승인된 작업의 `bth verify` 결과로 만듭니다.

## 프로젝트 규칙과 모순을 먼저 확인하기

`bth intelligence inspect`는 모델에게 저장소를 추측시키기 전에 Git 상태, 빌드·Wrapper, 지식 문서, Flyway 변경, DB dialect, 실행 Gate, Java/Kotlin/TypeScript/JavaScript/Python의 선언·계층·route·entity/table·test 구조를 제한된 범위로 수집합니다. 중첩된 portable backend가 하나로 식별되면 그 경로만 관찰해 sibling frontend 규칙을 섞지 않습니다.

```bash
node src/cli.mjs intelligence inspect /path/to/project
node src/cli.mjs intelligence inspect /path/to/project --json
# 명시적으로 로컬 캐시를 만든 뒤, 같은 명령으로 읽기 전용 재사용
node src/cli.mjs intelligence warm-cache /path/to/project
# 캐시를 배제한 비교·진단
node src/cli.mjs intelligence inspect /path/to/project --no-cache --json
```

`inspect` 자체는 캐시를 쓰거나 갱신하지 않습니다. `warm-cache`만 `.backend-harness/local/cache/`에 원자적으로 기록하며 이 경로는 공유 Git 상태에서 제외됩니다. 캐시는 Git 소스 지문과 HEAD에 묶이고, 소스가 바뀌면 변경된 Java/Kotlin만 다시 파싱합니다. Git이 무시한 JVM 소스나 submodule 내부 소스가 색인 범위에 있으면 루트 지문만으로 내용을 증명할 수 없으므로 캐시를 사용하지 않습니다. 캐시가 없거나 오래됐거나 변조·손상·과대·symlink 상태이면 검사 실패를 숨기지 않고 새 색인으로 돌아갑니다. 결과의 `code.metrics.parsedFiles`, `reusedFiles`, `readBytes`로 실제 재사용량을 확인할 수 있습니다.

`.backend-harness/project-rules.json`의 규칙은 `confirmed`, `unknown`, `conflict` 세 상태로 평가됩니다. 근거가 없거나 서로 충돌하면 성공으로 올리지 않습니다. `blocker` 규칙이 해결되지 않으면 인터뷰의 계획 확정도 막히며, 각 결과에는 규칙을 정한 문서 경로·section과 실제 fact 근거가 함께 남습니다. 출처는 프로젝트 안의 일반 Markdown 파일과 실제 존재하는 제목이어야 하므로, 가짜 절 이름이나 symlink 출처는 설정 단계에서 거절됩니다. 기본 템플릿은 구조화된 테스트 결과를 내는 required JUnit Gate, 기존 Flyway migration 불변성, 필수 지식 문서, 명시적 DB dialect를 검사하지만 회사별 규칙은 팀이 이 파일과 연결된 정책 문서에서 소유해야 합니다.

내장 fact에 없는 회사 규칙은 `.backend-harness/project-facts.json`에서 `project.*` 이름으로 선언합니다. 각 값은 프로젝트 안의 Markdown 문서와 실제 제목을 가리켜야 하며, BTH는 문서 SHA-256까지 남깁니다. 여러 provider가 같은 fact에 다른 값을 주면 `conflict`가 되고, 프로젝트 fact가 `git.*`, `database.*` 같은 내장 권한을 덮어쓰는 것은 거절됩니다. `project-declared` fact는 계획·질문·규칙 평가의 근거일 뿐 테스트 PASS 권한은 없습니다.

```json
{
  "schemaVersion": 1,
  "providers": [{
    "id": "team-policy",
    "version": "2026-08-30",
    "authority": "project-declared",
    "facts": [{
      "id": "project.api.compatibility.required",
      "status": "confirmed",
      "value": true,
      "summary": "공개 API 호환성 검토가 필수다.",
      "sources": [{
        "path": ".backend-harness/policies/api.md",
        "section": "Compatibility"
      }]
    }]
  }]
}
```

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

현재 참조 구현은 MySQL 8.4 LTS를 기준으로 합니다. 예제는 고정된 `mysql:8.4.11` 이미지를 사용해 Flyway migration, MySQL `JSON`·`ENUM`·`utf8mb4`, 실제 JDBC 왕복, 실패·시간초과 뒤 컨테이너 정리를 검증합니다. 읽기 전용 intelligence는 versioned Flyway SQL에서 primary/unique/secondary 복합 인덱스 선언을 source hash와 함께 모으고, JPA의 native query, `SELECT *`, leading wildcard, bulk DML, transaction, pessimistic lock, eager to-one, fetch join/page 조합을 검토 후보로 연결합니다. 이것은 실제 MySQL metadata, `EXPLAIN ANALYZE`, 런타임 N+1을 확인한 것이 아니므로 결함 판정이 아니라 구현·리뷰 질문만 만듭니다. Core는 MySQL에 종속되지 않지만, 지금 DB Pack의 첫 번째 실전 지원 경로는 MySQL입니다.

운영 DB, 배포, 실제 비밀값은 기본 기능에 없습니다. H2나 SQLite에서 SQL 문자열 하나가 통과했다고 MySQL migration이 안전하다고 주장하지 않습니다. Atlas 같은 SQL 분석기는 향후 project-owned Findings Gate로 추가할 수 있지만, 실제 MySQL 통합테스트를 대체할 수 없습니다.

## 코드그래프의 정확한 위치

현재 그래프는 Java/Kotlin의 복수 type 선언·상속·구현·보수적 주입 관계와 TypeScript/JavaScript/Python의 고유하게 해석된 정적 module import를 서로 다른 provenance로 기록합니다. route, 명시적 table, source role, 테스트 관계와 SQL·설정·템플릿의 경로 전용 artifact도 node metadata에 남깁니다.

포함하지 않는 것:

- 이름이 같다는 이유로 추측한 method call
- Spring runtime bean wiring의 실제 선택 결과
- reflection·동적 프록시
- SQL/table 소유권 추측
- 그래프 기반 테스트 생략

그래프 파일에는 `advisory: true`, 허용 용도(`navigation`, `review-questions`, `impact-localization`), 금지 용도(`pass-verdict`, `test-skipping`)가 함께 기록됩니다. edge 가중치, 방향별 의존/피의존 도달성, 반복형 SCC 분석, weighted PageRank를 사용하지만 컴파일러 call graph인 척하지 않습니다. 두 권한 목록은 각각 최대 16개의 짧은 식별자로 제한되어 작은 context budget을 우회해 응답을 부풀릴 수 없습니다. 생성 파일은 loader와 같은 16 MiB 상한을 넘으면 생성 단계에서 실패합니다.

그래프 Pack이 현재 소스에 묶인 성공한 observation을 만들었다면 그 봉인된 결과를 재사용합니다. `bth work` 구현 시 선행 graph run이 없으면 현재 source fingerprint를 전후로 확인하면서 메모리에만 bounded graph를 만들고, 요구사항과 가까운 production/test 경로를 제한된 예산 안에서 전달합니다. 중첩 backend가 하나로 관찰되면 sibling frontend는 이 즉석 그래프에서도 제외합니다. 즉석 그래프는 저장되지 않고 PASS 권한도 없습니다.

```bash
node src/cli.mjs task export-plan USER-17 /path/to/project \
  --context-budget 4000 --json
```

BTH는 요구사항의 단어를 path/type과 대조하고, provenance별 가중치가 있는 edge 위에서 bounded Personalized PageRank를 계산합니다. 가장 강한 lexical seed에서 dependencies와 dependents를 방향별로 펼치고 순환 컴포넌트도 표시합니다. 선택된 production node에 이름·경로 관례로 유일하게 연결된 test node가 있으면 같은 문자 예산 안에서 한 개를 바로 함께 선택해, 작은 변경이 관련 테스트를 뒤늦게 다시 찾는 비용을 줄입니다. 결과에는 점수뿐 아니라 사용한 문자 수, 누락된 node 수, graph 생성값, edge provenance와 알려진 한계가 들어갑니다. 그래프가 없거나 오래됐거나 run record와 digest가 다르면 계획 export는 실패하지 않고 `codeContext.status: "unavailable"`과 이유를 돌려줍니다.

합성 순위 회귀는 50개 node, 4개 요구사항, 20개 distractor가 있는 versioned fixture에서 같은 API로 측정하며 현재 Recall@5와 Recall@20은 모두 `1.0`입니다. 별도로 `npm run benchmark:public -- --allow-network`는 Spring Petclinic, NestJS Boilerplate, Full Stack FastAPI Template의 고정 commit 20개를 clone하고 각 실제 변경 파일을 gold로 검증합니다. production/test pair 동시 선택을 추가한 뒤의 공개 corpus 관찰값은 mean Recall@5 `0.4390`, Recall@20 `0.7200`, nDCG@20 `0.5042`, Recall@20=0 작업 `0개`입니다. 이전 관찰값은 각각 `0.3682`, `0.7075`, `0.4908`이었습니다. 이는 **변경 파일 위치 찾기**의 재현 가능한 관찰일 뿐 구현 성공률이나 회사 저장소 정확도 주장이 아닙니다. 원본 코드·artifact 본문은 evidence에 저장하지 않습니다.

위 공개 corpus 수치는 과거 과제 문구로 측정한 기록입니다. 날짜 허용 방향뿐 아니라 이메일 변경·CORS·인증 과제의 실제 요구사항도 원본 코드와 대조해 수정했습니다. 수정된 20개 과제의 정적 파일 탐색은 Recall@5 **0.3682**, Recall@20 **0.6190**, nDCG@20 **0.4467**이며, Swagger 과제는 실제 파일을 39번째로 놓쳤습니다. 아직 탐색 품질에 개선이 필요합니다. 요구사항 자체가 바뀌었으므로 이전 수치와의 차이를 알고리즘 개선/퇴보로 단정하지 않습니다. 새 결과는 corpus·요구사항·설정 hash로 구분합니다. [20개 과제의 대조 근거와 남은 검증](docs/evidence/corpus-behavior-audit-v21.md).

실제 Codex/Claude 구현 비교는 별도 비용 승인 하에서 같은 20개 작업을 BTH lane과 direct lane으로 실행합니다. 수정 후 파일은 양쪽의 `outcomeLocalization`으로만 비교합니다. `impactLocalization`의 BTH 값은 요청에 제공한 코드 문맥 순위, direct 값은 provider 이벤트에서 관찰한 pre-write 경로입니다. 서로 다른 관찰 경로이므로 완전히 동일한 영향 분석 측정이라고 주장하지 않습니다. direct의 실제 내용 읽기를 단순 파일 목록·검색 발견보다 앞에 순위화하며 미측정을 0점이나 수정 결과로 대체하지 않습니다. lane 시간은 provider 실행과 자체 사후 검증을 포함하며 BTH는 계획·격리 준비 시간도 포함합니다. 공통 사전 준비와 독립 수락 검사는 별도이고 `totalElapsedMs`에 전체 시간이 남습니다. token은 total/input/cached/uncached/output/reasoning을 분리하고, provider가 evaluator 소유의 build/test 명령을 중복 실행하면 규칙 위반으로 기록합니다.

```bash
# 비용 없이 80개 case 계획만 확인
npm run benchmark:providers -- --plan

# provider 호출 전 공개 저장소 clone·의존성·동일 verification 준비만 확인
npm run benchmark:providers -- --preflight \
  --task spring-02-owner-search-whitespace --output /tmp/bth-provider-preflight --allow-network

# 한 provider·한 작업의 BTH/direct 쌍대 실행: 명시적인 비용 승인 필요
BTH_PROVIDER_BENCHMARK=I_UNDERSTAND_PROVIDER_COSTS \
npm run benchmark:providers -- --execute --provider codex --lane both \
  --task spring-02-owner-search-whitespace --output /tmp/bth-provider-comparison \
  --allow-network
```

provider 비교는 공개 이력을 target commit 없이 단일 합성 base commit으로 만들고 gold 경로를 provider에게 전달하지 않습니다. raw provider 출력·소스 본문은 결과에 저장하지 않고 digest, byte count, 사용량, pre-write 경로와 명령 종류 집계만 남깁니다. `--all`은 provider당 40회 호출이므로 별도의 `BTH_PROVIDER_BENCHMARK_ALL=I_UNDERSTAND_40_PROVIDER_RUNS` 승인이 추가로 필요합니다.

기존 테스트 통과는 `verificationSuccessAt1`이며, 요청한 기능의 성공과 다릅니다. `successAt1`은 수정 전 코드에서는 실패하고 정답 코드에서는 통과하는 독립 회귀 테스트로 해당 구현도 확인했을 때만 인정합니다. 그 검증이 없으면 `null`이며, 전체 성공률도 미측정 항목이 남은 동안 확정하지 않습니다. schema 2 이하의 과거 `successAt1`은 기존 테스트 통과 관찰값으로만 취급합니다.

v25 시점에 기능별 독립 회귀 검증이 준비된 과제는 **6/20개**였습니다: 반려동물 연결, 소유자 이름 공백 처리, 방문일 검증, 식별자 변조 방어, 기존 반려동물 수정, NestJS 파일 저장·비동기 응답 처리. 수정 전에는 해당 동작이 실패하고 정답 코드에서는 통과하는 대조 검증을 했습니다. HTTP의 직접·중첩 ID 변조와 정상 입력 유지, JPA/H2의 저장 후 재조회·중복 방지·기존 검증도 확인합니다. H2 결과를 MySQL 검증으로 취급하지 않습니다.

NestJS 과제는 실제 클래스와 Observable을 실행해 **수정 전 3개 실패·4개 통과 → 수정 후 7개 통과**를 확인했습니다. DB 경계는 mock이므로 DB/S3/E2E 검증이 아닙니다. 기본 단위 테스트가 없는 프로젝트는 일반 검증을 통과한 것으로 취급하지 않습니다. v26은 생성된 Jest 계약의 테스트 목록이 실제로 비었음을 별도 확인한 경우에만 ‘첫 테스트 작성’ 비교를 허용합니다. 모델을 부르기 전에 독립 대조 검증도 통과해야 하며, 구현 후에는 실제 실행된 테스트 1개 이상과 전체 필수 검증, 독립 과제 검증이 모두 필요합니다. **대조군 준비 완료는 AI의 구현 성공이 아닙니다.** 컴파일 실패·누락/중복/건너뛴 테스트도 성공으로 세지 않습니다. [기존 Nest 검증·Jest 판정과 한계](docs/evidence/nest-verification-v25.md), [Spring 기능 대조 검증](docs/evidence/spring-acceptance-v24.md).

반려동물 연결 과제도 고정 모델·빠른 모드로 실제 비교했습니다. 둘 다 구현과 독립 검증을 통과했지만, BTH는 **146.3초·286,654토큰**, 직접 Codex는 **144.6초·283,135토큰**으로 효율 우위를 확인하지 못했습니다. 단일·순차 실행이라 캐시와 순서의 영향도 남습니다. [당시 비교와 한계](docs/evidence/fast-comparison-v22.md).

v26에서 실제 Codex 비교는 서로 다른 **3개 과제**가 됐습니다. NestJS의 최초 비교는 양쪽 모두 실패했습니다. 테스트 작성 계약을 보완한 재비교에서는 **BTH: 123.3초·288,253토큰·실패 / 직접 Codex: 88.2초·209,000토큰·통과**였습니다. 이 과제에서 하네스 우위는 없었습니다. 최초 실패와 재비교를 모두 보존하며, 20개 과제 완료나 2배 성능을 주장하지 않습니다. [첫 테스트 경로 개선과 불리한 실제 비교 결과](docs/evidence/first-test-workflow-v26.md).

v29에서는 독립 대조 검증이 **8/20개**, 실제 Codex를 시도한 과제가 **4개**가 됐습니다. 새 이메일 충돌 과제는 하네스·단독 모두 기본 검사 대상 밖의 E2E 테스트를 작성해 실패했습니다. 실제 Jest 설정의 테스트 위치·이름 규칙을 구현 요청에 붙이도록 보완했고, 후속 실행은 올바른 위치에 테스트를 작성했지만 컴파일 오류로 여전히 실패했습니다. 검증 성공·성능 우위를 주장하지 않으며, 실패 원인을 자동 복구 입력에 더 구체적으로 전달해야 합니다. [새 대조군·실제 비교·수정·남은 실패](docs/evidence/nest-acceptance-v29.md).

v30은 컴파일 실패의 **오류 코드·프로젝트 안의 파일·줄 번호**만 복구 요청에 전달합니다. 실제 Codex가 컴파일 오류를 고쳤지만, 이어진 Jest import 설정 문제로 자동 복구는 실패했습니다. 새 검사 설정이 명시된 TypeScript `baseUrl`을 제한적으로 반영하도록 보완한 뒤, 같은 코드를 새 임시 프로젝트에서 재검증해 **후보 테스트 3개·독립 요구사항 검사 7개·안전 적용 후 테스트 3개**를 통과했습니다. 이것은 설정 보완 후 재현 검증이며, 첫 시도 AI 성공이나 속도·토큰 절감의 증거는 아닙니다. 독립 과제 수는 여전히 **8/20개**입니다. [실패 비용·보완 범위·적용 검증·남은 한계](docs/evidence/execution-recovery-v30.md).

이후 검색어에 검증·운영 문장이 섞이는 문제를 고쳤습니다. 계획과 규칙은 그대로 전달하고, 코드 검색에는 인터뷰의 원래 요구사항을 사용합니다. 같은 **2,000자 제공 제한**에서 16개 과제의 파일 탐색 Recall@20은 **0.3741 → 0.4126**으로 개선됐지만 일부 순위는 내려갔고, 나머지 4개는 DB 변경 절차 설정이 없어 계획이 막혔습니다. 토큰·시간 감소는 아직 입증하지 않았습니다. [개선·퇴보·미완료를 함께 기록한 결과](docs/evidence/retrieval-query-v22.md).

그 4개의 중단 원인도 수정했습니다. TypeORM·Alembic 설정과 연결된 변경 파일을 읽기 전용으로 확인하고, 새 DB 초기화와 기존 DB 업그레이드를 나눠 **20/20개 계획을 생성**했습니다. 이것은 구현·DB 테스트 성공이 아닙니다. 2,000자 제한의 전체 20개 탐색 Recall@20은 **0.4365**였고, 그 시점의 실제 기능별 독립 검증은 **3/20개**였습니다. [DB 계획 수정·지원 범위·남은 검증](docs/evidence/database-planning-v23.md).

사용량은 완전한 마지막 실행 결과 이벤트에서만 수집합니다. Claude의 `input_tokens`는 캐시 읽기·생성 토큰을 포함하지 않으므로 총 입력은 세 값을 합하고 `cacheCreationInput`도 별도로 기록합니다. Codex의 입력에서는 보고된 캐시 입력을 빼서 미캐시 입력을 계산합니다. 누락된 값이나 마지막 응답 한 개의 사용량을 실행 전체의 합계로 추정하지 않습니다. 정의 근거: [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

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

# 자유문은 사람이 읽고, 선택적 claims는 Core가 결정적으로 모순을 검사합니다.
node src/cli.mjs interview answer USER-17 /path/to/project \
  --question data --text "migration은 필요하지만 DB 변경은 없다" \
  --claims '{"changesDatabase":false,"requiresMigration":true}' \
  --by developer

# 모순 후보는 답을 고치거나, 현재 후보 SHA에 묶인 사람의 사유로 해소해야 합니다.
node src/cli.mjs interview resolve USER-17 /path/to/project \
  --candidate database-migration-without-database-change \
  --reason "기존 테이블 변경이 아니라 신규 호환 view를 만드는 migration이다" \
  --by reviewer

# scope → data → verification → constraints도 같은 방식으로 답합니다.
# 이미 답한 결정은 다른 답을 잃지 않고 고칠 수 있습니다.
node src/cli.mjs interview revise USER-17 /path/to/project \
  --question scope --text "users 모듈과 관련 테스트만 변경" --by reviewer

# 인터뷰 도중 소스가 바뀌었다면 답을 보존한 채 현재 Git 상태에 다시 묶습니다.
node src/cli.mjs interview rebind USER-17 /path/to/project --by developer

node src/cli.mjs interview finalize USER-17 /path/to/project --by developer
```

`bth intelligence inspect /path --no-cache`는 `.backend-harness/verification.json`이나 초기화된 계약이 전혀 없어도 Git 저장소를 수정하지 않고 실행됩니다. 이때 추론한 Gate는 설명용일 뿐 `verification.status: missing`, `overallStatus: unknown`으로 남으며 PASS 권한을 갖지 않습니다. `bth init`은 실제 Gradle/Maven 정의와 wrapper/JVM 호환성뿐 아니라 저장소가 선언한 Jest·Vitest·Pytest와 중첩 test project를 읽어 프로젝트 문서·전용 실행 래퍼·JUnit report 계약을 생성합니다. `doctor`는 필요한 project-local runtime, 모든 탐지 모듈의 report coverage, JVM이면 활성 Java와 wrapper 호환성을 함께 검사하며 모르는 상태를 `healthy`로 승격하지 않습니다.

인터뷰 시작 시 BTH는 Git 지문, 빌드 정의, 소스·테스트 수, Flyway, DB dialect, 품질 정책, `verification.json` Gate를 읽기 전용으로 수집합니다. 파일별 JVM 색인은 `bth intelligence inspect`에서 볼 수 있고, 장기 보관 인터뷰 스냅샷에는 크기 폭증을 막기 위해 파일 목록 대신 집계·누락 수만 남깁니다. 질문은 완료 조건·변경 범위·DB 영향·검증·제약의 다섯 가지이며, 한 번에 현재 질문 하나만 답할 수 있습니다. 질문의 힌트는 감지한 MySQL/Flyway/Gate 사실을 보여 주지만 답을 대신 채우지는 않습니다. 확정되지 않은 답은 `--status unknown` 또는 `--status conflict`로 남길 수 있지만 해결 전에는 계획을 확정하지 못합니다. `--claims`를 사용하면 DB 변경/migration, 포함·제외 모듈, 필수 Gate, 공개 API 호환성처럼 명시된 조합만 Core가 검사합니다. 자연어 의미를 추측하지 않으며, 후보 해소는 후보 내용과 현재 context snapshot의 SHA-256, actor·사유·시간에 묶입니다. `rebind`로 context가 바뀌면 같은 문장으로 보이는 후보도 다시 검토해야 합니다.

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
# 다음 개발자가 plan/context/implementation authoring을 이어받기 전 명시적 인수인계
node src/cli.mjs task handoff USER-17 /path/to/project \
  --from developer --to teammate --reason "결제 adapter 구현을 teammate가 담당"
# 어떤 코딩 에이전트에도 넘길 수 있는 읽기 전용 JSON 계약
node src/cli.mjs task export-plan USER-17 /path/to/project --json
# 설치된 CLI 확인 후 Codex 또는 Claude를 한 번 명시적으로 연결
node src/cli.mjs implement providers /path/to/project
node src/cli.mjs implement configure codex /path/to/project \
  --mode auto --allowed-prefixes '["src/","pom.xml"]'
# 승인된 plan.md 범위만 격리 worktree에서 구현
node src/cli.mjs implement run USER-17 /path/to/project \
  --by developer --allow-write --acknowledge-network-risk
node src/cli.mjs implement status USER-17 /path/to/project
# 통과한 sealed candidate를 검토한 뒤 rollback 가능한 방식으로 원본에 적용
node src/cli.mjs implement apply USER-17 /path/to/project \
  --by developer --allow-write
# 실패 기록·격리 worktree를 감사 영수증과 함께 폐기해야 할 때만
node src/cli.mjs implement reset USER-17 /path/to/project \
  --by developer --discard-workspace
# 적용된 diff를 사람이 검토한 뒤
node src/cli.mjs verify USER-17 /path/to/project
# 실제 소스 검증까지 끝난 뒤 격리 worktree만 감사 기록과 함께 정리
node src/cli.mjs implement cleanup USER-17 /path/to/project \
  --by developer --discard-workspace
# 실패했다면 sealed run record에서 Gate·테스트·재실행 명령을 설명
node src/cli.mjs diagnose USER-17 /path/to/project
```

Task의 context·plan·implementation authoring에는 한 명의 active writer가 있습니다. 처음 actor가 lease를 잡고, 다른 개발자는 `task handoff` 이벤트가 hash chain에 기록된 뒤에만 작성할 수 있습니다. 계획 승인과 실행 검증은 별도 서명 역할이므로 writer 소유권을 빼앗지 않습니다. 서로 다른 Git clone에서 같은 `events.jsonl`을 갈라 썼다면 BTH가 자동 병합하지 않습니다. task/interview 아래 unmerged index entry가 하나라도 있으면 replay 전에 중단하고, 팀이 Git 충돌과 전체 hash chain을 검토하도록 요구합니다.

BTH Core는 모델을 PASS 판정기로 사용하지 않습니다. 대신 설치된 Codex CLI와 Claude Code를 내장 provider adapter로 실행하거나, 기존처럼 프로젝트가 소유하는 명령 wrapper를 연결할 수 있습니다. 어느 경로든 계획·승인·검증 판정은 모델의 주장과 분리됩니다.

`implement configure`는 비활성 템플릿만 기본적으로 바꾸고, 이미 설정된 adapter는 `--force` 없이는 교체하지 않습니다. 교체 전 파일은 `.backend-harness/local/backups/`에 보관됩니다. schema v1 command adapter는 계속 읽을 수 있고 `bth config migrate /path --allow-write`가 원본 backup을 남긴 뒤 schema v2 command adapter로 결정적으로 옮깁니다. provider는 `shell: false`로 실행되고 위험한 sandbox-bypass flag를 사용하지 않으며, 매 실행에 `--allow-write --acknowledge-network-risk`가 다시 필요합니다.

```json
{
  "schemaVersion": 2,
  "adapter": {
    "kind": "provider",
    "provider": "codex",
    "network": true,
    "timeoutMs": 1800000,
    "model": null,
    "mode": "auto",
    "contextBudgetCharacters": null,
    "maxBudgetUsd": null
  },
  "writePolicy": {
    "allowedPrefixes": ["src/", "build.gradle.kts"],
    "maxChangedFiles": 40,
    "maxDiffBytes": 2097152
  },
  "recovery": { "maxAttempts": 2 }
}
```

`auto`는 구조화된 interview claims와 source-bound 규칙·인접 코드 근거로 작업 강도를 정합니다. migration이 필요하거나, DB 변경인데 migration 필요 여부가 미확정이거나, 공개 API 호환성을 지키지 못하는 변경은 `deep`(12,000자/high effort)입니다. 반대로 단일 모듈·migration 없음·DB 영향 명시·API 호환성 유지가 모두 확인되고, 차단 규칙이 해결됐으며, 현재 source에 묶인 관련 코드 경로도 있을 때만 DB를 읽고 쓰거나 호환 가능한 CRUD API를 추가하는 작업을 `fast`(2,000자/low effort)로 선택합니다. 차단 규칙이나 인접 코드 근거가 미확정이면 `balanced`(6,000자/medium effort), 차단 규칙이 충돌하면 `deep`입니다. 비차단 경고의 미확정은 숨기지 않고 provider request에 유지하되 그 자체만으로 작은 작업을 느리게 만들지는 않으며, 알려진 비차단 충돌은 balanced로 올립니다. 승인된 task 본문은 fast/balanced/deep별 8,000/24,000/64,000자로 별도 제한하며, 자동 모드의 큰 작업은 deep으로 올리고 64,000자를 넘으면 작업을 나누도록 실패합니다. 모르는 작업을 가볍다고 추측하지 않습니다. 명시적 `--mode fast|balanced|deep` 설정과 64~32,768자의 code-context override도 기록됩니다.

provider request에는 승인된 계획, 허용 경로·diff budget, 봉인된 graph 또는 현재 source에서 즉석 생성한 bounded graph의 제한된 상위 문맥, `projectConventions` 규칙·지식 문서·인접 코드 경로, 직전 실패 요약만 들어갑니다. 소스 본문 전체를 복사하지 않고 프로젝트 상대 경로를 전달합니다. 즉석 graph 전후에 source fingerprint가 바뀌면 구현을 시작하지 않습니다. 요청 파일 자체도 실행 전후 SHA-256으로 봉인됩니다. provider는 이미 source-cited 형태로 평가된 규칙을 시작 계약으로 사용하고, 이번 작업과 직접 관련되거나 미확정 사항을 해결하는 문서 절만 다시 엽니다. 가장 높은 production 경로와 짝지어진 test를 먼저 확인하고 이름·계층·DTO/오류·트랜잭션·영속성·테스트 관례를 보존합니다. MySQL/JPA 작업에는 query shape, 인덱스 선언, transaction, lock, fetch/N+1 후보를 별도 검토하되 정적 패턴을 실제 query plan이나 runtime 결함으로 과장하지 않습니다. 차단 규칙을 확인할 수 없거나 코드와 충돌하면 추측해 수정하지 않습니다. provider는 build/test/formatter/linter/package-manager/Docker/DB 명령을 실행하지 않고 편집만 담당하며, 이후 BTH가 변경 경로에 맞는 feedback Gate와 전체 필수 Gate를 각 책임에 맞게 실행합니다. provider 이벤트에서 evaluator 소유 검증 명령이 관찰되면 구현 성공과 별개로 규칙 위반입니다. 최종 PASS에서 전체 Gate를 생략하지 않습니다. provider의 서로 다른 출력은 input/uncached-input/output/cache/reasoning/total token, USD 비용, 시간, turn의 공통 schema로 정규화하며 관찰값일 뿐 PASS 권한은 없습니다. 코드 변경이 전혀 없으면 첫 호출에서 `no-source-change`로 멈추고 Gate와 맹목적 recovery를 실행하지 않습니다. 내장 provider는 이미 로그인된 로컬 CLI 세션을 사용하며 API-key 환경변수는 의도적으로 전달하지 않습니다.

모델용 관례 문맥은 모든 선언 규칙·차단 상태·권한과 선택된 코드 순위를 보존하면서, source-pattern 예시를 관련 경로 우선으로 그룹당 fast/balanced/deep 각각 1/2/4개, 테스트 쌍을 2/4/8개로 선별합니다. 생략 수와 모드를 기록하고 전체 관찰은 승인된 인터뷰 snapshot에 남깁니다. 그래프 알고리즘의 수렴 통계와 중복된 전역 경로는 모델용 요청에서 줄이며, JSON은 공백 없는 기계용 형식으로 저장합니다. 같은 Spring 작업의 요청은 `52,340B → 26,580B`로 줄었지만 이것만으로 provider 총 토큰이나 완료 시간이 같은 비율로 줄었다고 주장하지 않습니다.

`fast`가 제한하는 것은 BTH가 추가하는 task·code context와 provider effort입니다. 각 CLI가 자체적으로 붙이는 system prompt, tool schema, cache traffic까지 작아진다는 뜻은 아닙니다. 2026-08-30의 작은 합성 Java 구현 smoke에서 BTH request는 각각 약 1.6 KiB였지만 Codex는 총 input 97,449(그중 cached 82,688), Claude는 input 6 + cache creation 13,849 + cache read 80,424와 약 $0.076을 보고했습니다. 이 값은 한 환경의 관찰값이지 일반 성능 보장이 아닙니다. Claude는 `--max-budget-usd`를 전달할 수 있지만 현재 사용한 Codex CLI에는 같은 달러 상한이 없어 effort·timeout·attempt 한도로만 제한합니다. 따라서 내장 provider는 승인된 구현용이며, 짧은 질문을 항상 저비용으로 답하는 chat router는 아직 아닙니다.

프로젝트 고유 CLI를 유지하려면 schema v1 command adapter도 계속 지원합니다. 이 경우 기존 request schema v1을 그대로 유지하고, `adapter.command[0]`은 프로젝트 안의 검토 가능한 wrapper여야 하며 BTH가 `--request <local-json>`을 추가합니다.

실행 조건과 경계:

- 새로 초기화한 단일 npm-lock 기반 Jest·Vitest 프로젝트는 implementation schema v2에 `workspacePreparation: { "kind": "npm-ci-offline", "projectPath": ".", "timeoutMs": 180000 }`를 갖습니다. `null`이면 끕니다. 선언한 package/lock을 확인한 뒤 격리 worktree에서만 `npm ci --offline --ignore-scripts --no-audit --no-fund`를 실행합니다. 원본 `node_modules`를 수정하거나 공유 링크로 연결하지 않습니다.
- 캐시에 필요한 패키지가 없으면 모델 호출 **0회**로 실패 기록을 남깁니다. 허용된 의존성을 따로 준비한 뒤 같은 `bth work ... --approve --run` 명령으로 이어갈 수 있습니다. 기존 승인을 재사용하되 소스·계획 일치를 다시 검사합니다. 준비 과정이 소스를 바꿨다면 재시도 대신 workspace reset이 필요합니다.
- 준비 지원 범위는 standalone npm lockfile v2/v3입니다. npm workspaces, file/git/link 의존성, shrinkwrap, overrides·bundled dependencies는 임의 처리하지 않고 거절합니다. 오래된 lock의 SHA-1 항목은 개수로 별도 기록합니다. lifecycle scripts가 필요한 패키지는 이 준비만으로 실행 가능하다고 보장하지 않습니다. 온라인 fallback이나 OS 네트워크 격리는 제공하지 않습니다.
- 기존 `.backend-harness/implementation.json`은 자동 교체하지 않습니다. 새 생성 계약은 버리는 복사본에서 diff를 검토한 뒤 적용해야 합니다. `implement configure`는 이미 설정된 preparation을 보존합니다. 이전 BTH 버전은 새 필드를 이해하지 못할 수 있으므로 팀 버전을 맞춰야 합니다. 이 소스 변경은 npm 새 정식 버전 발행이 아닙니다.
- source-bound 계획이 사람에게 승인됐고 원본 소스가 clean이어야 합니다.
- 매 실행마다 `--allow-write`, 네트워크 어댑터는 `--acknowledge-network-risk`도 필요합니다.
- 구현은 `~/.local/state/backend-team-harness/worktrees/`의 현재 사용자 전용(0700·소유자 확인) 루트에 만든 detached worktree에서만 진행됩니다. Git worktree 등록 때문에 원본 저장소의 `.git/worktrees` 메타데이터는 바뀌지만 bound source 파일은 바꾸지 않습니다.
- 현재 격리 구현은 harness 프로젝트 루트와 Git 최상위가 같은 저장소만 받습니다. monorepo 하위 서비스는 경로를 잘못 인증하지 않고 명시적으로 거절하며, project-scoped worktree 증거는 로드맵 항목입니다.
- 허용 prefix·파일 수·diff bytes를 넘긴 변경, `verification.json`, 구현 wrapper, Gate 실행 파일 변경은 실패로 분류됩니다.
- 어댑터가 격리 `HEAD`를 commit/reset으로 움직이거나 공유 branch/tag ref, assume-unchanged, skip-worktree를 바꿔도 해당 시도는 실패합니다. 소스 diff는 immutable base commit과 비교합니다.
- 실패 Gate와 테스트 요약만 다음 bounded repair 요청에 들어갑니다. 최대 5회를 넘길 수 없습니다. 단, Gate가 후보 파일·전체 변경 경로·공유 ref·숨김 index flag를 바꾸면 작업공간 신뢰가 깨진 것으로 보아 자동 repair를 중단하고 reset을 요구합니다.
- 로그인 실패, 비용 한도 초과, rate limit, 설치된 CLI와 argv의 비호환, 소스 변경 없음처럼 같은 입력을 즉시 반복해도 해결되지 않는 결과는 한 번만 기록하고 중단합니다. 일반 provider 실패와 실제 Gate 실패만 남은 recovery budget 안에서 재시도합니다.
- 실패 횟수를 소진했거나 오래된 구현 기록을 폐기할 때는 `implement reset --by ... --discard-workspace`가 worktree를 제거하고 원본 sealed record와 별도 sealed reset receipt를 보관합니다.
- 통합 후 task가 `VERIFIED` 또는 `DONE`이면 `implement cleanup --by ... --discard-workspace`가 격리 worktree를 제거하되 passed record와 이전 seal 연결은 유지합니다.
- 격리 검증이 통과해도 자동 merge·commit·배포·운영 DB 접근·`VERIFIED` 전환은 하지 않습니다. 사람이 diff를 반영해야 하며, isolated task의 `bth verify`는 상태가 `VERIFY_FAILED`여도 격리 결과의 전체 Git 변경 경로·일반 파일 내용·삭제·실행 비트·선언 입력이 실제 소스와 정확히 일치할 때만 시작합니다. 인증 목록 밖의 추가 변경과 symlink 구현은 거절됩니다.
- 이 경계는 우발적인 경로 탈출과 잘못된 인증을 막는 하네스 정책이지 악성 프로젝트 실행 파일을 가두는 OS sandbox가 아닙니다. 프로젝트가 고른 adapter와 Gate는 신뢰 코드로 취급합니다.

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

`bth work`의 **구현 중 실패**도 `bth diagnose <id> [path] --json`으로 확인할 수
있습니다. 모델 호출 전 의존성 준비 실패, 실패한 검사와 테스트 이름, 종료 코드,
원본 코드 변경 여부를 구분합니다. 남은 재시도 횟수는 실행 승인이 아니며,
진단 명령 자체는 코드를 수정하거나 테스트를 실행하지 않습니다. 민감한 원문
로그·assertion 본문은 복구 요청에 넣지 않고 이름은 길이 제한과 비밀 제거를
적용합니다. 임의의 테스트 이름까지 완벽히 익명화한다고 보장하지는 않습니다.

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
├── local/implementation/<id>.json      # seal된 구현/복구 요약
├── local/implementation/archive/       # 폐기된 record + reset receipt
└── local/optimization/gate-history.json # aggregate only, Git ignored
```

격리 구현 worktree 자체는 저장소 안이 아니라 `~/.local/state/backend-team-harness/worktrees/<project-key>/`에 있습니다.

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
