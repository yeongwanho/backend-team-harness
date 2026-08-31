# v38 — 프로젝트 포맷을 구현과 검증 사이에 연결

## 결론

프로젝트가 명시한 포맷 도구로 서식 오류를 처리하고, 그 뒤 실제 테스트를
실행하는 경로를 구현했다. 기본은 꺼져 있다. 작은 작업에 포맷 명령을
추측해서 추가하지 않으며 코드 변경이 없으면 실행하지 않는다.

**전체 하네스나 이번 실제 작업이 완성됐다는 뜻은 아니다.** 보존된 실제
Java 후보는 포맷을 통과한 뒤 일반 테스트 62개 중 2개에서 오류가 났다.
독립 기능 검사 6개는 통과했지만 일반 테스트 실패를 무시하거나 적용을
허용하지 않았다. 기존 v37 첫 시도 실패 기록은 그대로다.

## 실제 후보에서 확인한 것

대상은 공개 Spring Petclinic의 `spring-04-future-visit`이다. v37에서 실제
Codex가 작성한 BTH 후보를 새 복사본으로 옮겼으며 정답 구현을 복사하거나
모델을 다시 호출하지 않았다.

| 확인 항목 | 결과 |
|---|---|
| 포맷 도구 | 프로젝트 POM의 Spring JavaFormat 0.0.47, Maven offline 실행 |
| 포맷 변경 | 기존 후보의 `VisitControllerTests.java` 한 파일만 변경 |
| 포맷 시간 | 최종 재현 6.940초, 프로세스 6.879초 |
| 원문 백업 | 후보 파일 총 23,027 bytes, 비공개 로컬 경로 |
| 일반 테스트 | 62개 실행, 실패 0, 오류 2 → 전체 미통과 |
| 독립 기능 검사 | 오늘/과거 거부·미래 허용·기본 날짜·최소 날짜·번역·설명 필수 6/6 통과 |
| 모델 호출 | 0; 저장된 후보를 재현하는 fixture 1회 |
| 원래 후보·이전 결과 | 변경되지 않음 |

포맷 시간은 다른 로컬 QA와 함께 실행된 한 번의 관찰값이다. 전체 개발
시간이나 토큰 절약률로 환산하지 않는다. 초기에 관찰한 약 3.8초 실행은
개발 중 탐색 결과이며, 최종 소스 해시를 확인한 재현 기록과 구분한다.

두 일반 테스트 오류는 `initNewVisitForm`과
`processNewVisitFormRejectsTodayWithLocalizedMessage`에서 발생했다.
AI가 작성한 XPath assertion이 HTML을 XML로 파싱하면서 `link` 종료 태그에
대한 `SAXParseException`을 냈다. 포맷이 고쳐야 할 문제가 아니라 테스트
작성 방식의 문제다. 기능 검사 통과만으로 일반 테스트를 생략하지 않았다.

독립 검사는 기존 v37의 해시가 일치하는 base/target 대조군 증거를 재사용하고
새 후보 복사본에서 실행했다. 대조군을 이번에 다시 실행했다고 주장하지
않는다. 일반 테스트 실패 후의 별도 진단 실행이며 success@1이 아니다.

재현 스크립트와 산출물:

- [재현 절차](artifacts/v38/replay-visit-formatting.mjs)
- [실제 후보 결과·파일 해시·오류 진단](artifacts/v38/visit-replay.json)
- [자체 QA](artifacts/v38/qa.json)
- [20개 작업 목표의 현재 상태](artifacts/v38/goal-status.json)

## 구현한 경계

`formatting`은 schema-v2의 선택 설정이다. 실행 파일과 설정 입력이 기존
검증 입력으로 선언되어 있어야 하며, 승인한 소스와 달라지면 실행을 거부한다.
provider 교체는 설정을 보존한다. 실행 전 후보 검사와 실행 후 검사를 같은
함수로 묶어 기준이 달라지지 않게 했다.

프로젝트 명령 실행 전 32 MiB 이내의 원문 복구본을 보관한다. 명령이 후보
이외 파일을 바꾸거나 파일을 추가·삭제하거나 권한·검증 기준·Git 정보를
바꾸면 통과하지 못한다. 이런 결과는 벤치마크 규칙 위반에도 포함된다.
실행 실패·timeout에는 자동 모델 재시도를 소비하지 않는다. 경계 위반 뒤
재실행하려면 먼저 오염된 workspace를 reset해야 한다.

검증 과정에서 새 결함을 먼저 재현했다. 기존 코드는 `formatting` 설정을
거부했고, 설정을 읽게 해도 실제 실행이 없어 후보가 실패했다. 구현 뒤
정상 동작·옵트아웃·무변경·입력 변조·범위 초과·삭제·권한 변경·timeout·Git
변조·복구 크기 제한을 검사했다. 포맷 경계 위반이 벤치마크 규칙 수에
누락되는 문제도 실패하는 테스트로 확인한 뒤 수정했다.

## 제한과 다음 작업

자체 QA는 **582개 중 578 PASS, 0 FAIL, 4 SKIP**이다. 줄 커버리지 91.33%,
분기 82.91%, 함수 98.69%이며, 선정한 mutation 39/39를 검출했다.
mutation은 전체 가능한 변이를 검사한 수치가 아니다. 설치 smoke와 Windows
계약 8/8이 통과했고 운영 의존성 취약점은 0개다. 실제 MySQL, 별도 cold-cache
JVM, Windows provider·프로세스 종료 skip은 PASS로 계산하지 않았다.

이 기능은 OS sandbox가 아니다. `network: false`도 실제 egress 차단이
아니다. 신뢰할 수 있는 프로젝트 명령만 사용해야 하며, 사후 검사가
임의 프로세스의 외부 부작용이나 변경의 의미를 전부 보장하지 못한다.
복구본에는 소스 원문이 있으므로 공유하지 않는다. Windows ACL과 실제
provider/자식 프로세스 종료는 여전히 실제 Windows 검증이 필요하다.

이 단계에서 새 provider 비교쌍은 추가하지 않았다. 서로 다른 과거 프로토콜의
8개 paired task를 하나의 성공률로 합치지 않는다. 20개 목표, Claude 비교,
MySQL 실작업, 신규 개발자·실제 Windows 도입 검증은 아직 완료되지 않았다.

다음 개선은 **HTML 테스트 assertion 같은 실제 실패를 정확한 근거로
복구하는 것**과 아직 실행하지 않은 작업을 평가하는 것이다. 추가 기능이나
테스트 개수만 늘려서 제품 완성으로 판정하지 않는다.

포맷 명령·구현 범위의 1차 근거는 [공식 Spring JavaFormat 문서](https://github.com/spring-io/spring-javaformat)와
[0.0.47 FormatMojo 소스](https://github.com/spring-io/spring-javaformat/blob/v0.0.47/spring-javaformat-maven/spring-javaformat-maven-plugin/src/main/java/io/spring/format/maven/FormatMojo.java)다.
Maven includes는 source root별 상대 경로로 적용되므로, BTH가 임의로 전체
프로젝트 경로 패턴을 만들어 안전한 범위 제한이라고 주장하지 않았다.
