# Testing

## 자동 검증

```bash
npm test
npm run build
```

현재 suite는 상태 전이, offline wake에서 model ready까지 orchestration, runtime reuse/health failure, typed launch validation, workspace traversal rejection, tool policy, deterministic agent loop/budget/cancel/approval, 검색 mode routing/dedup/fallback/timeout, reasoning capability fallback, Deep Review sequencing, citation UI, composer cancellation, Qwen/OpenAI response normalization, model selector 동작을 검증합니다. TypeScript production build는 strict typing과 Vite bundling을 함께 확인합니다.

Rust가 설치된 환경에서는 다음을 추가합니다.

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

Windows 장비에 Ollama가 이미 실행 중이면 다음 비파괴 harness로 실제 tunnel 경계를 검증합니다. credential은 인자로 받지 않으며 로컬 SSH agent/key 설정을 사용합니다.

```bash
npm run test:e2e:windows -- \
  --target user@windows-host \
  --model hf.co/0xSojalSec/Qwen3.8-27B-Uncensored-Cyber-agent:IQ4_XS-imatrix-fromq8 \
  --remote-port 11434
```

검증 항목은 localhost SSH forwarding health, OpenAI-compatible SSE 완료, invalid model 오류, tunnel 종료 후 reconnect입니다.

## 수동 Mock 시나리오

1. `npm run dev` 실행 후 Settings → Application → Mock Mode 확인
2. 메시지 전송
3. `PC를 시작하는 중 → 안전하게 연결하는 중 → 모델을 불러오는 중 → 준비됨` 확인
4. token 단위 응답과 Markdown/code block 렌더링 확인
5. 새 대화/대화 재선택/삭제 후 새로고침 persistence 확인
6. 모델 변경 후 다음 메시지가 새 모델을 사용하는지 확인
7. Advanced Mode에서 credential 없는 단계 로그만 표시되는지 확인
8. 검색 `off/auto/on` 각각에서 Mock Search 호출 여부와 citation card 확인
9. 추론 `fast/normal/deep/deep-review` 선택과 Draft → Critique → Final Revision 단계 표시 확인
10. 생성 중 정지 버튼으로 즉시 non-pending 상태가 되고 다음 메시지를 보낼 수 있는지 확인

## Windows E2E 체크리스트

- online/offline 각각의 wake 경로
- 올바른 키, 잘못된 키, Keychain password 인증
- SSH disconnect 후 제한 재연결
- runtime stopped/running/crashed 상태
- health timeout과 방화벽 차단
- 모델 A → B 전환과 process ownership
- SSE 정상 완료/중간 단절/비정상 HTTP status
- Credential Manager에 Tavily 키가 저장되고 localStorage/로그에 남지 않는지 확인
- Tavily native HTTPS 요청과 검색 timeout/cancel이 UI 상태까지 전파되는지 확인
- Deep Review 각 단계 timeout, SSE final revision 취소, 재시도 가능 상태 확인
- citation/source link가 기본 브라우저로 열리는지 확인
- Tauri Windows package에서 검색 IPC allowlist와 CSP 경계 확인
- 앱 종료 기본 정책이 Windows/runtime을 변경하지 않는지 확인

## 2026-10-15 실기기 결과

Windows 11 Pro 장비에 비대화형 SSH key 인증으로 연결해 다음을 확인했습니다.

| 시나리오 | 결과 | 근거 |
|---|---|---|
| Windows ON → SSH | PASS | `BatchMode=yes` 연결 성공 |
| Windows localhost runtime discovery | PASS | Ollama 11434와 Qwen 계열 tool-capable models 확인 |
| local port forwarding health | PASS | Mac `127.0.0.1:18080`을 통한 `/api/tags` 응답 |
| OpenAI-compatible SSE | PASS | `/v1/chat/completions` chunk stream과 `[DONE]` 확인 |
| Qwen 3.8 Cyber streaming | PASS | 실제 `Qwen3.8-27B-Uncensored-Cyber-agent`가 완전한 SSE와 `[DONE]` 반환 |
| Qwen 3.8 Cyber tool calling | PASS | 실제 Cyber Agent 모델이 `list_directory` tool call JSON 반환 |
| invalid model | PASS | harness가 비정상 모델의 HTTP 실패 확인 |
| tunnel reconnect | PASS | listener 종료/재생성 후 health 회복 |
| Native Tauri SSH tunnel | PASS | macOS 앱이 system SSH local forwarding으로 Windows Ollama `/api/tags` HTTP 200 확인 |
| Ollama cold start | PASS | 11434 리스너 중지 후 앱이 WMI 독립 프로세스로 `ollama serve`를 시작하고 `준비됨` 복구 |
| Native Cyber chat | PASS | 앱 UI에서 실제 Cyber 27B 스트리밍 응답 `CYBER_READY` 렌더링 |
| 기본 llama.cpp profile paths | EXPECTED FAIL | 샘플 `C:\\llama.cpp`, `C:\\models`가 장비에 없음 |
| Windows OFF → WOL | NOT RUN | 현재 장비가 켜져 있고 MAC/broadcast 값이 제공되지 않음 |
| runtime crash/forced restart | NOT RUN | 실행 중 Ollama는 앱 소유 process가 아니므로 종료하지 않음 |
| Windows reboot | NOT RUN | 비파괴 검증 범위에서 시스템 재부팅을 수행하지 않음 |

OFF/WOL/reboot는 Settings에 장비 MAC/broadcast를 입력하고 유지보수 창을 확보한 뒤 수동 체크리스트로 실행합니다. 외부 Ollama process를 임의 종료하지 않는 결과는 process ownership 요구사항에 부합합니다.

macOS ARM64 환경에서 `npm test`, production build, `cargo fmt --check`, `cargo check`, `cargo test`, Mock Agent 브라우저 flow를 검증했습니다. `npm run tauri build -- --bundles app`은 17.29 MiB `Local LLM.app` 생성을 통과했고, Finder AppleEvent를 사용하지 않는 `CI=true npm run tauri build`는 17.29 MiB `.app`과 6.16 MiB `.dmg`를 모두 생성했습니다. 대화형 기본 DMG 명령은 이 호스트의 Finder AppleEvent 단계에서 실패할 수 있습니다. 실제 Keychain password 저장은 별도 credential 입력 시 검증합니다.
