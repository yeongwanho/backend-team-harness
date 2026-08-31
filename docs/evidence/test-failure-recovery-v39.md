# v39 — 실패한 테스트의 종류를 전달하고, 실제 복구를 다시 시험

## 이번에 달라진 것

AI가 테스트 이름만 보고 다시 추측하지 않도록, 검증 보고서의 표준 예외 종류를
복구 요청까지 전달했다. 예를 들어 `xml_parse_error`는 XML 파싱 오류를,
`assertion_failure`는 기대한 결과와 실제 결과가 다른 상황을 알려 준다.
회사별 예외 이름, 긴 오류 메시지, 응답 HTML, 스택 내용은 이 경로로 넘기지 않는다.

**이 개선은 구현했지만, 실제 작업의 자동 복구는 아직 실패했다.**
예외 종류를 아는 것만으로 프로젝트 설정까지 올바르게 이해하지는 못했다.
그래서 실패 후보를 적용하거나 전체 목표를 완료로 표시하지 않았다.

## 실제 실행 결과

공개 Spring Petclinic의 방문 날짜 제한 작업을 사용했다. v37의 보존된 후보를
새 복사본에 재현한 뒤 Codex를 한 번 호출했다. 그 결과를 또 다른 복사본에
재현한 뒤 Claude high를 한 번 호출했다. 각각 첫 번째 시도는 모델 호출이 없는
fixture 재현이고, 두 번째 시도만 실제 모델 호출이다.

| 단계 | 일반 테스트 62개 | 독립 기능 검사 6개 | 판정 |
|---|---|---|---|
| 원래 후보 재현 | XML 파싱 오류 2개 | 이전 기록 참고 | 복구 필요 |
| Codex 복구 후 | 오류 0, assertion 실패 1 | 6/6 통과 | 미완료 |
| Codex 결과를 받은 Claude high 복구 후 | assertion 실패 1 | 6/6 통과 | 미완료 |

독립 기능 검사는 일반 테스트 실패 후 별도의 복사본에서 실행했다. 통과해도
일반 테스트 실패를 덮어쓰지 않는다. 정답 구현은 모델에게 제공하지 않았으며,
이전 base/target 대조군은 같은 oracle 해시인지 확인해 재사용했다. 이번에
대조군을 새로 실행했다고 주장하지 않는다.

## 수정 내용까지 확인한 결과

Codex는 HTML을 XML로 읽던 XPath assertion을 응답 문자열 검사로 바꿨다.
파싱 오류는 없어졌지만 번역 테스트가 기대한 한국어 대신 영어 문구를 받았다.
테스트 삭제나 skip 추가는 없었다. 다만 `name="date"` 요소를 지정하던 검사가
본문 어디에든 같은 `min` 문자열이 있으면 통과하도록 넓어졌다. **assertion이
완전히 동등하게 유지됐다고 판정할 수 없다.** 별도 oracle은 날짜 input의
`name`과 `min`을 함께 확인하지만, 생성된 일반 테스트 자체도 개선 대상이다.

Claude는 테스트 대신 `Visit.java`의 `@Future`에 메시지 키를 명시했다.
변경은 그 파일 한 곳이며 테스트와 검증 설정은 그대로였다. 그러나 한국어
표시 테스트는 여전히 실패했다. 두 모델의 원래 입력 후보와 이전 결과 파일은
변경되지 않았고, 최종 소스 지문과 실행 당시 지문도 일치한다.

코드를 직접 읽어 보니 이 프로젝트는 세션에 저장한 언어를 사용하고 기본값은
영어다. 언어 전환은 `lang` 파라미터로 처리한다. 생성된 테스트는 요청의
`.locale(KOREAN)`만 바꾸고 있었다. 이는 다음에 확인해야 할 구체적인 설정
경계다. 모델의 추측처럼 메시지 키만 바꾸면 해결된다고 볼 근거는 없었다.
이번에는 세 번째 모델 호출이나 수동 정답 패치로 실패 기록을 바꾸지 않았다.
근거: [고정된 프로젝트의 언어 설정 코드](https://github.com/spring-projects/spring-petclinic/blob/3c06fbfc1e42eb40802e0d0ca989bc9226755804/src/main/java/org/springframework/samples/petclinic/system/WebConfiguration.java).

## 소모량 — 비교 점수가 아닌 실행 기록

| 실제 복구 호출 | 설정 | 호출 시간 | CLI 최종 usage 토큰 | 보고된 비용 |
|---|---|---:|---:|---:|
| Codex CLI 0.151.0 | gpt-5.6-sol, fast / low | 69.883초 | 229,182 | 미보고 |
| Claude Code 2.1.239 | deep / high, CLI 기본 모델 | 44.811초 | 376,412 | $0.4646272 |

입력에는 캐시 재사용 토큰도 포함한다. Codex는 input 226,694 / output 2,488,
Claude는 input 373,294 / output 3,118이다. Claude 이벤트의 주 모델은
`claude-sonnet-5`로 보고됐고 보조 `claude-haiku-4-5-20251001` 항목도 있었다.
위 토큰은 최종 `usage` 기준이며 보조 모델까지 별도 재합산한 전체 워크플로
총량이라고 보장하지 않는다. 원래 providerReported 수치를 함께 보관했다.
Codex의 미보고 비용을 0으로 계산하지 않는다.

두 호출은 입력 후보와 context/effort가 다르다. 시간에는 빌드·테스트가 포함되지
않는다. 후반 검증은 로컬 회귀 QA와 일부 겹쳤다. **모델 순위, 속도 향상률,
토큰 절약률, success@1로 사용할 수 없는 복구 체인**이다. historical pair도
갱신하지 않았다. 작은 수정에도 누적 토큰이 많다는 관찰은 개선 과제로 남긴다.

## 자체 검증과 남은 한계

- 589개 테스트: 585 PASS, 0 FAIL, 4 SKIP.
- 커버리지: 줄 91.36%, 분기 83.01%, 함수 98.70%.
- 선정한 mutation 40/40 검출. 전체 가능한 변이를 검사한 결과는 아니다.
- 설치 smoke 통과, Windows 계약 8/8 통과, 운영 의존성 취약점 0개.
- 실제 Windows 실행·종료, MySQL 컨테이너, 별도 cold-cache JVM 검사는 미검증.

새 회귀 테스트는 JUnit → 봉인할 검증 결과 → 다음 복구 요청 경로, 중복 제거,
입출력 수 제한, 알려지지 않은 타입, 타입/코드 불일치, 본문 속 가짜 예외 이름을
검사한다. 전체 경로 테스트는 첫 검증을 실제 실패시키고 두 번째 요청에 진단이
전달되는지 확인한다. 이 fixture의 성공과 실제 모델 복구 실패는 별개다.

전체 목표는 여전히 **3개 독립 백엔드 / 20개 작업**이다. 새 비교쌍은 0개다.
현재 구성된 oracle 11개 중 대조군 확인 10개, 과거 paired task 8개이며 서로
다른 프로토콜을 하나의 성공률로 합치지 않는다. 다음에는 미실행 작업과 native
전체 워크플로 기준선을 늘리고, assertion 실패에서 필요한 설정 근거를 적은
문맥으로 전달하는 방법을 검증해야 한다. 예외 종류만 추가한 것을 복구 완성으로
포장하지 않는다.

## 재현 가능한 증거

- [실제 복구 실행 절차](artifacts/v39/run-test-recovery.mjs)
- [Codex 실패·토큰·최종 소스 해시](artifacts/v39/codex-recovery.json)
- [Claude 후속 실패·토큰·최종 소스 해시](artifacts/v39/claude-recovery.json)
- [최종 QA](artifacts/v39/qa.json), [전체 목표 상태](artifacts/v39/goal-status.json)
- [완료된 로컬 결과의 검증·기록 스크립트](artifacts/v39/record-evidence.mjs)

배경 API: [Spring MockMvc assertion API](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/test/web/servlet/result/MockMvcResultMatchers.html),
[Java 21 SAXParseException](https://docs.oracle.com/en/java/javase/21/docs/api/java.xml/org/xml/sax/SAXParseException.html).
현재 API 문서는 진단 의미를 설명하는 참고 자료이며, 프로젝트의 고정 버전을
최신 Spring 버전으로 바꿨다는 뜻은 아니다.
