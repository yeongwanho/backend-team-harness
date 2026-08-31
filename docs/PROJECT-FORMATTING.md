# 프로젝트 서식 때문에 AI를 다시 부르지 않기

팀이 쓰는 포맷 도구를 AI의 코드 작성과 테스트 사이에 연결할 수 있습니다.
기본은 **꺼짐**입니다. 명령을 추측하거나 도구를 설치하지 않습니다.
코드 변경이 없으면 포맷과 테스트를 건너뛰고, 포맷 명령이 실패해도 AI를
자동으로 다시 호출하지 않습니다.

## 한 번만 설정하기

다음은 POM에 Spring JavaFormat **0.0.47**이 선언된 프로젝트용 예시입니다.
다른 프로젝트에는 팀의 기존 명령과 버전을 사용하세요.
`.backend-harness/implementation.json`의 `schemaVersion`을 `2`로 두고,
기존 adapter/writePolicy/recovery를 유지하며 아래 항목을 추가합니다.
아래는 전체 파일이 아니라 **추가할 부분**입니다.

```json
{
  "formatting": {
    "command": ["./mvnw", "-o", "-B", "io.spring.javaformat:spring-javaformat-maven-plugin:0.0.47:apply"],
    "inputs": [".editorconfig", "pom.xml"],
    "network": false,
    "timeoutMs": 60000
  }
}
```

`.backend-harness/verification.json`의 Gate `inputs`에도 실행 파일과 설정
파일을 포함하세요. 예시에서는 `mvnw`, `.editorconfig`, `pom.xml`입니다.
`mvnw`가 이미 Gate 명령이면 중복할 필요는 없습니다. 기존 입력은 유지하세요.
`.springjavaformatconfig` 등 추가 설정이 실제로 있다면 양쪽에 선언합니다.
없는 파일은 선언하지 않습니다.

이렇게 해야 포맷 기준도 승인한 소스에 포함되고 AI가 명령이나 기준을
바꿨는지 검사할 수 있습니다. Git에서 무시된 입력도 검사·복사 대상입니다.
설정 diff를 검토해 Git에 반영하고 새 소스로 계획을 승인해야 합니다.

다른 프레임워크에서는 `./tools/format` 같은 팀 소유 실행 파일을 사용할 수
있습니다. 프로젝트 안의 일반 파일만 허용하며 프로젝트 밖 경로, 심볼릭
링크, 셸 명령 문자열은 허용하지 않습니다. Windows Maven/Gradle wrapper는
`.cmd`/`.bat`로 선택됩니다. 사용자 스크립트는 팀이 해당 OS에 맞게 준비해야
하며 이 계약 검사가 실제 Windows 실행 검증을 대신하지는 않습니다.

## 실행과 복구

AI 작성 → 변경 범위 검사 → 비공개 백업 → 포맷 → 경계 재검사 → 테스트 순서입니다.
포맷은 AI가 이미 변경한 파일의 내용만 바꿀 수 있습니다. 다른 파일의 추가
변경, 후보 추가·삭제, 실행 권한 변경은 차단합니다. 저장소 전체를 재작성하는
도구라면 팀 스크립트에서 범위를 제한하세요. BTH가 source-root별 include
패턴을 추측하지는 않습니다.

명령 성공이 기능 완성은 아닙니다. 전체 필수 검증과 구조 검토를 생략하지
않고, 실제 테스트 실패에는 기존 구현 재시도 예산이 적용됩니다.

`bth implement status <id> <project> --json`의 `record.attempts[].formatting`에
결과·시간·변경 파일·백업 위치가 남습니다. stdout/stderr 본문 대신 해시와
바이트 수만 기록합니다. `formatting-failed`는 실행 실패,
`formatting-integrity-failure`는 경계 위반입니다. 후자는 reset하기 전
재실행할 수 없고 적용도 허용되지 않습니다.

백업은 원래 프로젝트의 `.backend-harness/local/formatting/candidate-*`입니다.
포맷 전 파일을 같은 상대 경로로 보관하고 옆 `.json`에 해시·파일 종류·실행
권한을 기록합니다. 총 32 MiB를 넘으면 포맷 전에 중단합니다. 자동 복원은
하지 않으므로 백업과 후보를 비교해 사람이 복구하거나 reset하세요.

백업에는 **소스 원문이 들어 있습니다**. POSIX에서는 파일 0600·새 디렉터리
0700 권한으로 만들지만 암호화는 아닙니다. Windows ACL은 별도 확인이 필요합니다.
공유·커밋하지 마세요. workspace reset/cleanup은 원래 프로젝트의
이 백업을 삭제하지 않으므로 팀의 로컬 보존 정책에 따라 관리하세요.

`network: false`는 선언이지 OS 네트워크 차단이 아닙니다. `true`이면 네트워크
위험 승인이 필요합니다. 신뢰하는 명령만 사용하세요. 사후 검사는 모든 외부
부작용을 막거나 변경이 공백에만 한정됐음을 증명하지 못합니다.

변경이 있는 시도마다 명령을 한 번 실행하므로 이미 서식이 맞는 코드에도
시간이 추가됩니다. 측정 없이 전체 속도 개선을 주장하지 마세요.
끄려면 `"formatting": null`로 설정합니다. 기존 설정은 자동 교체하지 않고
provider 변경도 이 항목을 보존합니다. 구버전은 이 필드를 거부할 수 있으니
팀 버전을 맞춰 사용하세요.
