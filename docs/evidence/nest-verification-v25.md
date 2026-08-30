# NestJS 실행 검증과 Jest 판정 보강

## 무엇이 달라졌나

이번에는 Spring 외의 실제 코드도 검증했다. NestJS의 파일 저장 결과와
비동기 응답 처리 과제에서, 수정 전에는 7개 중 3개가 실패하고 정답 코드에서는
7개 모두 통과했다. 전체 20개 과제 중 독립 대조 검증은 이제 6개다.
**AI 구현 성공 과제가 6개라는 뜻은 아니다.** 유료 Codex 비교는 기존 2개 과제뿐이다.

동시에 새로 생성하는 Jest 검증기에 있던 두 가지 잘못된 통과 경로를 막았다.

- 알 수 없는 테스트 상태가 passed로 변환됐다.
- 현재 실행이 결과를 만들지 않아도 이전 실행의 JSON으로 새 XML을 만들 수 있었다.

수정 전 두 회귀 테스트가 실제 exit 0 때문에 실패했다. 수정 후에는 둘 다
거절된다. 전체 개수·상태 모순, 실행 중단, 테스트 파일 실행 오류, 중복 이름,
결과 경로의 symlink, 크기 한도도 검사한다. 실패 메시지 본문이나 잘못된 JSON
내용을 오류에 복사하지 않는다. 자식 프로세스의 비정상 종료를 JSON이 덮을 수 없다.

## 실제 무엇을 실행했나

대상은 공개 저장소 `brocoders/nestjs-boilerplate`의 고정된 두 revision이다.

- 수정 전: `07ac5f29d3032bb173fd538c549966e7eb96dcff`
- 정답 코드: `f4703907ddc54dff7f6e81bc37f0a42e3fdd8d22`
- 도구: Node 22.23.1, Jest 29.7.0, ts-jest 29.3.4, TypeScript 5.8.3.
- 공개 임시 clone에서 `npm ci --ignore-scripts --no-audit --no-fund`로
  고정 lockfile 의존성을 준비했다. 두 대조군은 서로 다른 임시 clone에서
  `npm ci --offline --ignore-scripts --no-audit --no-fund`를 실행했다.
- `test/bth/run.cjs`가 실제 TypeScript 코드와 RxJS를 실행했다.
  `verify-jest.mjs`는 production 생성기와 바이트가 같은 runner다.
  fixture hash와 코드 일치 검사로 별도 판정 구현이 끼어들지 않게 했다.
- 모듈 로딩/컴파일 실패는 회귀 재현으로 인정하지 않는다. 지정한 일곱 테스트가
  모두 실제 실행되고, 원본 소스 snapshot이 동일해야 대조군으로 인정한다.

| 검사 | 수정 전 | 정답 코드 |
|---|---|---|
| 저장한 entity를 domain file로 변환 | 실패 | 통과 |
| 저장 실패 전달 | 통과 | 통과 |
| 단일 조회 변환과 null 유지 | 통과 | 통과 |
| 목록 조회 변환과 빈 결과 유지 | 통과 | 통과 |
| 실제 Observable emission에서 Promise 제거 | 실패 | 통과 |
| rejected Promise를 error channel로 전달 | 실패 | 통과 |
| upstream Observable 오류 유지 | 통과 | 통과 |

각 대조군은 소스가 변하지 않았다. 마지막 재검증 전체는 65,857ms였다.
다른 QA와 동시에 실행했으므로 이 시간을 성능 비교 수치로 사용하지 않는다.
원래 코드의 Promise를 단순히 await하면 결함이 숨겨질 수 있어, 테스트는
**Observable이 실제로 내보낸 값**을 모아서 확인한다.

별도의 실제 Jest 결과 형식 검사도 실행했다. `focused` suite와 `skipped` suite에서
총 4개 중 실행 1개·skipped 3개로 변환됐다. suite의 `focused`와 미완료 assertion의
`focused`를 혼동하지 않는다. Jest 29.7의 설치된 `@jest/test-result` 구현과
[CLI 문서](https://jestjs.io/docs/29.7/cli)를 대조했다.

## 아직 안 되는 것

동일 과제의 일반 public preflight는 **실패**했다. 설치는 통과했지만 기본 Jest
설정은 `src/`에서 단위 테스트 0개를 찾는다. 별도의 E2E는 외부 서비스 환경이
필요하므로 실행하지 않았다. 가짜 통과 테스트를 넣거나 `--passWithNoTests`로
성공처럼 만들지 않았다. 따라서 이 과제는 아직 `readyForProviderComparison=false`다.

DB는 mock 경계다. 실제 MySQL/PostgreSQL 저장, S3 서명, HTTP 전체 E2E,
Windows 인증 provider 실행, 강제 네트워크 격리를 증명하지 않는다.
`npm --offline`은 의존성 설치 설정이지, 테스트 프로세스의 OS 네트워크 sandbox가 아니다.
npm 10.1.0에서는 전이 의존성의 npm >=10.8.2 요구 경고가 있었고, 설치는 성공했다.
그 경고나 오래된 공개 fixture의 deprecation 경고를 최신 의존성 검증으로 바꾸지 않는다.

## 기존 프로젝트에 적용할 때

패키지만 바꿔도 이미 생성한 runner가 자동 갱신되지는 않는다. `bth init`은
팀 파일을 보존한다. 기존 runner를 쓰는 프로젝트는 다음 순서로 적용해야 한다.

1. 현재 팀 설정과 수정 내용을 커밋하거나 별도로 백업한다.
2. 프로젝트의 **버리는 복사본**에서 새 버전으로 `bth init --force`를 실행한다.
3. 생성된 `.backend-harness/bin/verify-portable.mjs`의 diff와 선언된 test 인자를 검토한다.
4. 필요한 runner 변경만 원본에 적용하고 실제 `bth check`를 다시 실행한다.

`init --force`는 runner만이 아니라 다른 공유 파일도 교체하고 백업을 만든다.
원본에서 무조건 실행하는 업데이트 명령으로 권하지 않는다. 이번 커밋은 소스
개선이며 새 npm 정식 릴리스를 발행한 것은 아니다.

## 재현과 근거

최종 전체 테스트는 **418개 중 414 PASS, 0 FAIL, 4 SKIP**다.
coverage는 line 90.28%, branch 79.70%, function 98.78%였다.
표적 mutation 9개는 정상 baseline 통과 후 assertion 실패로 모두 검출했다.
전체 가능한 mutation의 100%라는 뜻은 아니다. 설치 smoke와 문서 계약도 통과했다.
SKIP은 실제 MySQL, 실제 JVM 기본 opt-in 검사, Windows 실행·종료 검사다.
이전 증거의 실제 JVM 결과와 이번 기본 suite의 SKIP을 섞어서 계산하지 않는다.

```sh
node scripts/generate-nest-oracle-runner.mjs
node --test test/jest-report.test.mjs test/portable-jest-runner.test.mjs test/task-acceptance.test.mjs test/provider-benchmark-config.test.mjs
npm run test:coverage
node scripts/mutation-smoke.mjs
npm run test:install
node scripts/benchmark-provider-comparison.mjs --preflight --provider codex --task nest-02-file-relational-mapper --output /tmp/bth-nest-preflight --allow-network
```

독립 대조는 `evaluateTaskAcceptance`에 corpus의 해당 task, config의 acceptance,
공개 mirror 경로, `benchmarks/public-backend-v1` fixtureRoot를 전달해 실행한다.
외부 모델은 호출하지 않는다. 아래 산출물은 원문 로그가 아닌 판정·개수·hash다.

- [변경 전·후 실제 대조](artifacts/v25/acceptance-controls.json)
- [일반 preflight 실패](artifacts/v25/preflight.json)
- [실제 Jest skipped/todo 형식](artifacts/v25/jest-shape.json)
- [전체 QA와 실행 시 소스 fingerprint](artifacts/v25/qa.json)

마지막 대조 산출물 SHA-256:
`a34dd3402538774d8b645b5b640e57c42d4485e6b0d141dd5631faa60a8e6a9c`.
config SHA-256:
`5a40e38b067fc5bc9c33ebb55989c40d16f1982966a1f5d7b41fdbc8d2f608e7`.

첫 준비 실행에서 evaluator가 `node`를 프로젝트 파일로 해석해 거절했다.
이를 `node <고정된 JS 테스트 파일>`만 현재 evaluator Node로 실행하도록 보강했고,
구현 중 변수 이름 충돌 한 건도 회귀 테스트와 함께 수정했다. 이 두 실행은
기능 대조 성공에 포함하지 않았다. 후속 두 대조 실행에서 동일한 3실패→7통과를 확인했다.
