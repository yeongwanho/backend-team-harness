# 첫 테스트 작성 경로와 격리 의존성 준비

## 이번에 해결한 문제

테스트가 아직 없는 프로젝트에서도 첫 기능과 테스트를 만들 수 있어야 한다.
그렇다고 테스트 0개를 통과로 바꾸면 안 된다. 이번 변경은 두 상태를 분리한다.

- **시작 가능:** 생성된 Jest 계약의 테스트 목록이 실제로 비어 있고, 독립
  대조 검증이 정상 작동한다. 비교 실험에서 첫 테스트 작성을 시도할 수 있다.
- **완료:** 구현한 테스트가 실제 실행되고, 전체 필수 Gate와 독립 과제 검증을
  통과한다. 테스트 없음·전부 skipped·이전 결과 재사용은 완료가 아니다.

실제 `bth work`는 원래도 통과한 baseline을 선행 조건으로 요구하지 않았다.
막힌 곳은 비교 실험의 baseline 제한과, 격리 worktree에 없는 의존성이었다.
공개 NestJS 프로젝트의 고정 revision으로 두 경로를 확인했다.

## 코드에서 바뀐 것

1. npm lock이 있는 고유한 Jest·Vitest 프로젝트에 선택적 준비 계약을 생성한다.
   승인된 격리 구현에서만 고정된 `npm ci --offline --ignore-scripts`를 실행한다.
   원본 의존성을 수정하거나 mutable 공유 링크를 만들지 않는다.
2. 캐시가 없으면 모델 호출 없이 실패 기록을 남긴다. 같은 작업을 재실행할 때
   기존 승인을 다시 만들지 않고 소스·계획 일치를 검사해 이어간다. 준비 중
   소스나 Git ref가 바뀌면 재시도 대신 reset을 요구한다.
3. Git의 CRLF/LF 정규화로 생성된 Windows 실행 래퍼가 달라질 때 원본의 승인된
   바이트를 stage한다. 줄바꿈 외의 차이를 덮어쓰지는 않는다.
4. 선택 feedback이 전체 검증과 같으면 전체 검증을 한 번만 실행한다. 일부
   Gate만 선택됐을 때에는 빠른 feedback 후 전체 검증을 유지한다.
5. 모델의 **테스트 작성**과 하네스의 **테스트 실행** 책임을 명시했다. schema-v2
   요청에 필수 Gate와 최소 실행 테스트 수를 담는다. 단순 pass placeholder나
   검증 완화는 허용하지 않는다. 비교용 직접 Codex에도 같은 작성 지시를 넣는다.
6. 비교 결과에 준비 기록·테스트 개수·Gate 결과를 남긴다. 준비 실패의 모델
   시도 횟수는 0이고 성공률은 미측정이다. 임의의 실패한 모델 호출 1회로 세지 않는다.

## 실제 사전 검증

대상: `brocoders/nestjs-boilerplate`, `nest-02-file-relational-mapper`.
수정 전 `07ac5f29d3032bb173fd538c549966e7eb96dcff`, 기준 수정본
`f4703907ddc54dff7f6e81bc37f0a42e3fdd8d22`를 사용했다.

- 실제 Jest 열거: 정상 종료, 테스트 파일 0개, 소스 fingerprint 유지.
- 일반 baseline: 여전히 `confirmed: false`. 통과로 바꾸지 않았다.
- 독립 기능 대조: 수정 전 3개 실패·4개 통과, 기준 수정본 7개 통과.
- 실제 BTH 격리 준비: 1,635개 lock 항목, 8,133ms, 소스 유지, 온라인 재시도 없음.
  63개 SHA-1 integrity 항목은 별도 기록했다. 이를 최신 의존성 검증이라고 부르지 않는다.

## 첫 유료 비교의 실패도 보존

같은 `gpt-5.6-sol`, `fast` 모드, 최대 시도 1회로 순차 실행했다.
숨겨진 기준 수정본이나 evaluator 테스트는 모델에게 제공하지 않았다.

| 최초 프로토콜 | 하네스 | 직접 Codex |
|---|---:|---:|
| 모델 종료 | 정상 | 정상 |
| 자체 필수 검증 | 실패 | 통과 |
| 독립 과제 검증 | 후보 부적격으로 미실행 | 7개 중 1개 실패 |
| 최종 성공 | 실패 | 실패 |
| 구현·자체 검증 구간 | 61,261ms | 80,063ms |
| provider 총 토큰 | 193,100 | 223,159 |

하네스 후보는 production 파일 2개만 바꾸고 테스트를 쓰지 않았다. 직접 후보는
테스트를 작성했지만 독립 검증의 `create returns mapped domain data from the saved entity`
검사가 실패했다. 이 기록은 실패한 **검사 이름**을 확인한 것이며, 개별 assertion
본문이나 후보 소스를 보존하지 않아 더 좁은 근본 원인을 단정하지 않는다.
두 후보 모두 완료하지 못했으므로 위 시간으로 성능 우위를 주장하지 않는다.

이후 테스트 작성 지시를 강화하고 프로토콜 ID와 출력 폴더를 바꿨다.
최초 실패를 덮어쓰거나 두 프로토콜을 한 성공률로 합산하지 않는다.

## 수정 후 재비교: 하네스 우위를 확인하지 못함

모델·모드·기준 소스·숨겨진 독립 검증은 그대로 두고, 새 프로토콜
`first-test-v26-test-authoring`에서 각 lane을 한 번 더 실행했다.

| 수정 후 프로토콜 | 하네스 | 직접 Codex |
|---|---:|---:|
| 자체 테스트 | 3개 실행, 1개 실패 | 4개 실행, 모두 통과 |
| 독립 과제 검증 | 후보 부적격으로 미실행 | 7개 모두 통과 |
| 최종 성공 | **실패** | **통과** |
| lane 시작~자체 검증 종료 | 123,312ms | 88,180ms |
| provider 총 토큰 | 288,253 | 209,000 |
| 그중 캐시 입력 토큰 | 240,640 | 176,128 |
| 미캐시 입력 토큰 | 43,331 | 29,142 |
| 모델용 요청 크기 | 20,960B | 1,838B |

하네스 요청은 규칙·문맥·승인 상태도 포함하므로 요청 크기만으로 모든 정보가
불필요하다고 단정하지 않는다. 그러나 이 관찰에서는 **더 많은 문맥과 토큰이
성공으로 이어지지 않았다.** 테스트 작성 지시는 반영됐지만 실제 정확도까지
해결하지 못했다. 코드 생성 실패를 검증 시스템 성공이라고 바꿔 부르지 않는다.

위 시간에는 BTH의 계획·격리 준비도 포함된다. 공통 사전 설치·대조 검증·별도
후보 수락 검사는 포함하지 않는다. 각 원본 record의 `totalElapsedMs`에는 전체
실험 시간도 남아 있다. 비용 USD는 provider가 제공하지 않아 미측정이다.
네 번의 유료 호출과 최초 실패를 모두 보존했으며, 좋은 결과만 고르지 않았다.

다음 정확도 개선에 필요한 것은 실패 후보의 제한된 진단 보존, 실제 repair
실험, 규칙을 빠뜨리지 않는 요청 축소, 과제별 코드 검색 개선이다. 이번 실험은
시도 한도를 1회로 고정했으므로 실제 모델 자동 복구의 효과는 검증하지 않았다.

## 회귀 검증

전체 테스트는 **433개 중 429 PASS, 0 FAIL, 4 SKIP**이었다. coverage는
line 90.43%, branch 80.36%, function 98.80%였다. 표적 mutation은 정상
baseline을 통과시킨 뒤 12개 변경 모두 assertion 실패로 검출했다. 이번에는
offline flag 제거, 빈 목록 판정 완화, 동일 Gate 이중 실행 회귀도 포함한다.
이는 가능한 모든 mutation에 대한 100% 검출률이 아니다.

혼합 JVM+Node 초기화가 관계없는 npm 준비를 붙이지 않는지도 확인했다. 해당
경로는 원래 올바르게 동작했으므로 새 회귀 테스트만 추가했고 불필요한 코드는
수정하지 않았다. 실제 Windows 인증 실행과 MySQL 등 opt-in 환경은 SKIP이다.

## 남은 한계

- 과제 하나의 반복 관찰이다. 모델의 비결정성, 실행 순서와 캐시 영향을 분리한
  통계 실험이 아니며, 문장 변경의 인과 효과나 일반적인 속도 향상을 증명하지 않는다.
- 독립 대조는 6/20개, 유료 Codex 비교는 서로 다른 과제 3개뿐이다. 3개 백엔드와
  20개 과제 전체, Claude 비교까지 끝내야 하는 목표는 아직 완료되지 않았다.
- 이 Nest 검사에서 DB 경계는 mock이다. 실제 MySQL/S3/HTTP E2E, 실제 Windows의
  인증 provider 실행, OS 네트워크 격리를 증명하지 않는다.
- 첫 하네스 요청의 검색 Recall@20은 0.5였다. 변경된 두 정답 경로를 찾았다는
  결과와 검색 자체의 품질을 혼동하지 않는다. provider 이벤트 기반 읽기 경로도
  누락 가능성이 있는 보조 정보이며 Git 변경 증거를 대신하지 않는다.
- 준비 범위는 standalone npm lock v2/v3다. workspaces, local/git/link 의존성,
  shrinkwrap, overrides·bundled dependencies는 거절한다. install script가 필요한
  패키지는 별도 검토가 필요하다. `--offline`은 OS egress sandbox가 아니다.
- 기존 팀 설정은 자동 교체하지 않는다. 버리는 복사본에서 새 생성물과 diff를
  검토한 후 필요한 계약을 적용한다. 이번 변경은 npm 정식 릴리스 발행이 아니다.

## 재현과 근거

```sh
node --test test/workspace-preparation.test.mjs test/empty-test-baseline.test.mjs test/work-first-test.test.mjs
npm run test:coverage
node scripts/mutation-smoke.mjs
npm run test:install
node scripts/benchmark-provider-comparison.mjs --preflight --task nest-02-file-relational-mapper --output /tmp/bth-first-test-preflight --allow-network
```

유료 실행은 별도 비용 확인 환경변수와 `--execute --provider codex --lane both`,
고정 task/model/mode를 요구한다. 최초와 수정 후 비교는 각각 별도 산출물에 남긴다.
원문 provider 로그·소스·인증 정보 대신 개수·판정·해시를 저장한다.

- [사전 검증](artifacts/v26/preflight.json)
- [최초 두 후보의 실패](artifacts/v26/initial-comparison.json)
- [최초 실행 코드 해시](artifacts/v26/initial-runtime.json)
- [수정 후 비교](artifacts/v26/final-comparison.json)
- [전체 QA·검증 코드 해시](artifacts/v26/qa.json)
