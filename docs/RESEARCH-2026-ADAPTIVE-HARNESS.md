# 2026 adaptive backend harness research

조사일: 2026-08-30

## 먼저 결론

BTH 0.7은 “최신 수학”이라는 말만 붙인 기능을 넣지 않았다. 서로 다른 종류의 근거를 세 층으로 대조했다.

1. **논문과 벤치마크**에서 어떤 문제가 실제로 측정됐는지 확인했다.
2. **공식 엔지니어링 사례**에서 운영 환경의 안전장치와 실패 조건을 확인했다.
3. **공개 구현 코드**에서 아이디어가 실제 프로그램으로 어떻게 제한되고 기록되는지 확인했다.

그 결과 이번 버전에 채택한 것은 두 가지다.

- 모든 필수 검증을 유지하면서, 독립적으로 순서를 바꿔도 된다고 프로젝트가 선언한 Gate만 `p/c` 순서로 실행한다.
- provenance가 있는 구조 그래프를 Personalized PageRank와 방향별 도달성으로 정렬해, 정해진 문자 예산 안에서 계획을 수행할 사람이 먼저 볼 파일을 제시한다.

예측 모델로 테스트를 생략하는 기능, 그래프가 PASS를 결정하는 기능, 강화학습 기반 자동 정책은 채택하지 않았다. BTH에는 아직 이를 안전하게 보정할 실제 다중 프로젝트 운영 데이터가 없기 때문이다.

## 1. 연구 질문

| 질문 | 측정 대상 | 이번 판정 |
| --- | --- | --- |
| 실패를 더 빨리 발견할 수 있는가? | 첫 필수 실패 또는 전체 성공까지의 기대 시간 | 제한적으로 채택 |
| 테스트 일부를 안전하게 생략할 수 있는가? | 회귀 결함 누락률과 전체 실행 비용 | 데이터 부족으로 거절 |
| 큰 저장소에서 관련 코드를 덜 읽고 찾을 수 있는가? | 고정 문맥 예산 안의 관련 위치 회수 | 참고 기능으로 채택 |
| 그래프·모델의 판단을 완료 판정에 써도 되는가? | false PASS 위험 | 거절 |
| 에이전트 하네스 전체가 “2배 좋아졌다”고 말할 수 있는가? | 성공률·비용·지연·수정 품질의 공통 벤치마크 | 현재는 말할 수 없음 |

## 2. 검증 순서 최적화

### 2.1 수학적 목적함수

Gate `i`의 실패 확률을 `p_i`, 평균 실행 시간을 `c_i`라고 하자. Gate가 서로 독립이고 첫 필수 실패에서 멈춘다면, 순서 `1..n`의 기대 실행 시간은 다음과 같다.

```text
E[T] = Σᵢ cᵢ · Πⱼ<ᵢ (1 - pⱼ)
```

두 Gate `A`, `B`의 순서만 비교하면 다음 조건일 때 `A → B`가 더 낫다.

```text
cA + (1-pA)cB ≤ cB + (1-pB)cA
                 ⇕
             pA/cA ≥ pB/cB
```

따라서 이 가정 아래에서는 **실패할 가능성이 높고 비용이 싼 Gate부터**, 즉 `p_i / c_i` 내림차순으로 실행하는 것이 최적이다. 이 식은 새로운 만능 알고리즘이 아니라 고전적인 비용 기반 순서화 원리의 BTH 적용이다.

관측이 적을 때 실패율 `failures/samples`를 그대로 쓰면 1회 결과에 과민해진다. BTH는 Beta 사전분포로 다음처럼 평활한다.

```text
estimated p = (failures + priorFailures)
              / (samples + priorFailures + priorPasses)
```

기본 사전값은 `Beta(1,1)`이고, 모든 이동 대상 Gate가 최소 5회 관측되기 전에는 원래 순서를 유지한다.

### 2.2 외부 근거와 한계

- Meta의 [Predictive Test Selection](https://engineering.fb.com/2018/11/21/developer-tools/predictive-test-selection/)은 대규모 이력과 지속적인 보정을 사용해 테스트 비용을 줄인 운영 사례다. 하지만 그 결과를 소규모 새 프로젝트에 그대로 일반화할 수 없다.
- Microsoft의 [Test Impact Analysis](https://learn.microsoft.com/azure/devops/pipelines/test/test-impact-analysis)은 영향받은 테스트, 새 테스트, 이전 실패 테스트를 포함하고 일정 주기로 전체 테스트를 실행하는 fallback을 둔다. 안전한 선택에는 그래프만이 아니라 운영 정책이 필요하다는 근거다.
- RETECS의 [reinforcement-learning test prioritization 연구](https://arxiv.org/abs/1811.04122)는 테스트 우선순위를 학습하는 접근을 제시한다. 후속 [산업 데이터 연구](https://arxiv.org/abs/2011.01834)도 존재하지만, 학습 정책은 데이터 분포와 보상 정의에 의존한다.
- [동적 우선순위 연구](https://arxiv.org/abs/2402.02925)는 테스트 상관관계를 이용한 동적 정책이 이미 좋은 정적 순서보다 나빠질 수도 있음을 보인다. 복잡한 정책이 항상 더 좋은 것은 아니다.

그래서 BTH는 테스트 선택이나 생략을 하지 않는다. 사용자가 `reorderable: true`로 명시한 **연속된 required Gate 구간**의 dependency ready-set에서만 순서를 바꾸고, 성공 경로에서는 모든 Gate를 정확히 한 번 실행한다. 고정 Gate와 optional Gate는 이동 경계다. 병렬 실행도 `parallelSafe`, 서로 다른 `resourceClass`, bounded `maxParallel`을 모두 명시한 ready Gate에만 허용한다. 이력은 순서만 바꾸며 결과, 증거 등급, 테스트 수, source fingerprint, PASS 판정에는 영향을 주지 못한다.

### 2.3 “2배”의 정확한 범위

저장소의 결정적 fixture는 동일한 Gate 세 개와 동일한 posterior 추정치를 사용한다. 설정 순서와 `p/c` 순서의 기대 실패 피드백 시간을 비교한다.

```text
configured: 1711.983471 ms
adaptive:    473.884298 ms
speedup:       3.612661 x
```

Gate identity는 보존된다. 이 수치는 sleep이나 실제 빌드 시간을 재어 만든 값이 아니라, 명시된 독립 fail-fast 모형의 기대값을 재현한 것이다. 따라서 **“이 fixture에서 첫 실패 피드백 기대시간 3.61배 개선”**이라고만 말할 수 있다. BTH 전체 처리량, 실제 회사 프로젝트, OMO 대비 성능, 수정 성공률이 3.61배라는 뜻은 아니다.

## 3. 제한된 문맥 안에서 코드 찾기

### 3.1 왜 그래프와 검색을 함께 쓰나

- [Agent Retrieval Bench](https://arxiv.org/abs/2607.24882)는 여러 실제 저장소의 에이전트 궤적을 비교하며 단일 retriever가 모든 조건에서 우세하지 않다고 보고한다. 고정 문맥 예산에서는 repo-map 계열이 강하지만, 실제 궤적이 정답 파일을 전혀 담지 못하는 경우도 보고한다. 이 연구는 2026년의 새 preprint이므로 독립 재현 전까지 잠정 근거로 취급한다.
- [SWE-Explore](https://arxiv.org/abs/2606.07297)는 코드 수정 전에 관련 위치를 고정 line budget 안에서 찾는 능력을 별도 문제로 평가한다. 문맥 효율을 구현 성공과 분리해 측정해야 한다는 근거다.
- [DyRetriever](https://arxiv.org/abs/2608.01927)는 부분 의존성 그래프를 동적으로 확장하는 방식을 제안하지만 매우 최근 결과다. 현재 BTH의 정확한 import edge보다 넓은 의미 관계를 즉시 신뢰하기에는 이르다.
- [GraphCoder](https://arxiv.org/abs/2406.07003), [RANGER](https://arxiv.org/abs/2509.25257), [Agentless](https://arxiv.org/abs/2407.01489)는 저장소 수준 문제에서 localization을 독립 단계로 다루는 근거를 제공한다.

### 3.2 공개 구현에서 확인한 것

- Aider의 [repository map 구현](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/repomap.py)은 정의·참조 그래프, PageRank 계열 순위, mention 기반 개인화, token budget에 맞춘 축약과 cache를 실제로 결합한다.
- SCIP의 [정확한 코드 인텔리전스 프로토콜](https://github.com/scip-code/scip/tree/a7b9c65a8aa148a79b67cc7f6dafea154dbc63d0)은 정의·참조 관계의 정확한 출처를 다루는 더 강한 향후 경로다. 현재 BTH Pack은 compiler index가 아니므로 SCIP 수준의 정확성을 주장하지 않는다.
- Oh My Pi의 [auto-repair 구현](https://github.com/can1357/oh-my-pi/blob/33cc6b9a043a74e00a157e72ca909272796d8461/packages/coding-agent/src/edit/auto-repair.ts)은 바뀐 구간을 국소화하고 제한된 후보를 시도한 뒤 전체 parse로 확인한다. “좁게 찾고 넓게 검증한다”는 경계가 중요하다.
- Ouroboros의 [evaluation pipeline](https://github.com/Q00/ouroboros/blob/3d7502008f62e0ce5ea37746a0da8b3f824c861a/src/ouroboros/evaluation/pipeline.py)은 기계 검증을 먼저 하고, 의미 평가와 조건부 합의를 뒤에 둔다. BTH도 결정적 검증과 자문 정보를 분리한다.
- learn-claude-code의 [workflow runtime](https://github.com/shareAI-lab/learn-claude-code/blob/0dcafa2ae053a1ddd6a72f265431104b08a5aa13/s16_workflow_runtime/README.md)은 snapshot, journal, 의미적 키, resume 재사용, 병렬 barrier를 작은 예제로 설명한다. BTH의 sealed record와 retry-safe 상태 설계에 참고했다.

### 3.3 BTH의 제한된 구현

현재 graph Pack은 Java/Kotlin의 고유하게 해석된 import·상속·구현과 보수적인 주입·테스트 관계를 서로 다른 provenance edge로 만든다. 계획 export 시 다음 순서로 처리한다.

1. 최신 graph observation이 현재 source fingerprint에 묶인 sealed run에서 성공했는지 확인한다.
2. graph 파일의 byte 수와 SHA-256이 run record와 같은지 확인한다.
3. 요구사항 단어와 path/qualified name의 일치로 teleport prior를 만든다.
4. provenance별 forward 가중치와 역방향 0.5의 Personalized PageRank를 최대 30회 계산한다.
5. query match가 있으면 lexical prior 0.6, graph score 0.4를 결합한다.
6. JSON entry의 실제 문자 수를 누적해 사용자가 준 hard budget을 넘기지 않는다.

이 결과는 `REPORTED/advisory`다. 탐색과 리뷰 질문에는 쓸 수 있지만 PASS, 테스트 생략, 런타임 호출 관계 주장에는 쓸 수 없다. Reflection, 실제 Spring bean 선택, generated code, 동적 SQL ownership, method call은 아직 모른다고 명시한다.

## 4. 하네스 구조 자체에 대한 조사

- OpenAI의 [Harness engineering](https://openai.com/index/harness-engineering/)은 저장소를 system of record로 만들고, 구조적 불변조건을 자동 검사하며, 에이전트가 스스로 환경을 읽고 검증할 수 있게 해야 한다고 설명한다.
- [Codex agent loop 해설](https://openai.com/index/unrolling-the-codex-agent-loop/)은 모델과 도구 실행 loop를 분리해 보여준다.
- 2026년 preprint [AI Harness Engineering](https://arxiv.org/abs/2605.13357)과 [Harness Engineering for predictable agentic software](https://arxiv.org/abs/2608.26197)은 trace와 structured planning을 강조한다. 둘 다 최근 문헌이라 확정된 업계 표준으로 인용하지 않고, BTH의 명시적 상태·계획·증거가 측정 가능한지 검토하는 보조 자료로만 사용했다.

BTH는 여기서 하네스의 모든 기능을 가져오지 않는다. 모델 라우터, 다중 에이전트 팀, 장기 memory, 자동 source write보다 먼저 백엔드 팀에 필요한 **요구사항 → 승인된 계획 → 실제 DB/테스트 실행 → source-bound 증거**의 폐쇄 회로를 우선한다.

## 5. 채택·보류·거절 표

| 아이디어 | 상태 | 이유 |
| --- | --- | --- |
| required Gate의 opt-in `p/c` 순서화 | 채택 | 목적함수와 안전 경계를 명시하고 결정적으로 시험 가능 |
| Beta smoothing + 최소 관측치 | 채택 | 작은 표본의 과민 반응 완화 |
| source-bound graph digest | 채택 | 오래되거나 바뀐 그래프를 계획 문맥으로 쓰지 않음 |
| bounded Personalized PageRank | 채택 | 예산·출처·한계를 결과에 함께 남길 수 있음 |
| graph 기반 테스트 생략 | 거절 | 현재 graph가 call/runtime/coverage graph가 아님 |
| ML/RL 기반 테스트 선택 | 보류 | 실제 프로젝트 corpus, 누락 비용, 재보정 체계가 없음 |
| “confidence” 단일 점수 | 거절 | 서로 다른 provenance를 한 숫자로 숨김 |
| LLM이 PASS 결정 | 거절 | 재현 가능한 실행 증거가 아님 |
| OMO보다 전체적으로 2배 우수하다는 주장 | 거절 | 제품 목적과 공통 benchmark가 다르고 실측 없음 |

## 6. 다음 연구가 필요한 지점

1. 독립적으로 관리되는 백엔드 저장소 두 개 이상에서 onboarding 시간과 실제 실패 피드백 시간을 측정한다.
2. Gate 결과의 상관성과 순서 의존성을 기록하되, 독립 가정이 깨지는 Gate는 즉시 고정한다.
3. 정기 전체 실행을 유지한 채 coverage-to-test observation index의 recall을 측정한다.
4. Java/Kotlin은 SCIP/컴파일러 또는 bytecode provenance를 가진 sidecar를 별도 실험한다.
5. MySQL migration은 실제 빈 스키마와 중요 upgrade path의 시간을 분리 측정한다.
6. 코드 문맥은 gold file/region이 있는 합성 및 공개 backend 과제로 Recall@budget, nDCG, downstream completion을 측정한다.

이 측정 전까지 BTH 0.7의 성과 주장은 다음 한 줄을 넘지 않는다.

> 안전 조건을 만족하는 검증 순서 fixture에서 기대 실패 피드백 시간이 3.61배 줄었고, 필수 Gate와 PASS 판정 규칙은 그대로 보존됐다.
