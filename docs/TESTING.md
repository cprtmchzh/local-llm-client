# Testing

## 자동 검증

```bash
npm test
npm run build
```

현재 suite는 상태 전이, offline wake에서 model ready까지 orchestration, runtime reuse/health failure, typed launch validation, workspace traversal rejection, tool policy, deterministic agent loop/budget/cancel/approval, Qwen/OpenAI response normalization, model selector 동작을 검증합니다. TypeScript production build는 strict typing과 Vite bundling을 함께 확인합니다.

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
  --model qwen3:8b \
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

## Windows E2E 체크리스트

- online/offline 각각의 wake 경로
- 올바른 키, 잘못된 키, Keychain password 인증
- SSH disconnect 후 제한 재연결
- runtime stopped/running/crashed 상태
- health timeout과 방화벽 차단
- 모델 A → B 전환과 process ownership
- SSE 정상 완료/중간 단절/비정상 HTTP status
- 앱 종료 기본 정책이 Windows/runtime을 변경하지 않는지 확인

## 2026-10-15 실기기 결과

Windows 11 Pro 장비에 비대화형 SSH key 인증으로 연결해 다음을 확인했습니다.

| 시나리오 | 결과 | 근거 |
|---|---|---|
| Windows ON → SSH | PASS | `BatchMode=yes` 연결 성공 |
| Windows localhost runtime discovery | PASS | Ollama 11434와 Qwen 계열 tool-capable models 확인 |
| local port forwarding health | PASS | Mac `127.0.0.1:18080`을 통한 `/api/tags` 응답 |
| OpenAI-compatible SSE | PASS | `/v1/chat/completions` chunk stream과 `[DONE]` 확인 |
| Qwen tool calling | PASS | 실제 `qwen3:8b`가 `list_directory` tool call JSON 반환 |
| invalid model | PASS | harness가 비정상 모델의 HTTP 실패 확인 |
| tunnel reconnect | PASS | listener 종료/재생성 후 health 회복 |
| 기본 llama.cpp profile paths | EXPECTED FAIL | 샘플 `C:\\llama.cpp`, `C:\\models`가 장비에 없음 |
| Windows OFF → WOL | NOT RUN | 현재 장비가 켜져 있고 MAC/broadcast 값이 제공되지 않음 |
| runtime crash/forced restart | NOT RUN | 실행 중 Ollama는 앱 소유 process가 아니므로 종료하지 않음 |
| Windows reboot | NOT RUN | 비파괴 검증 범위에서 시스템 재부팅을 수행하지 않음 |

OFF/WOL/reboot는 Settings에 장비 MAC/broadcast를 입력하고 유지보수 창을 확보한 뒤 수동 체크리스트로 실행합니다. 외부 Ollama process를 임의 종료하지 않는 결과는 process ownership 요구사항에 부합합니다.

macOS ARM64 환경에서 `npm test`, production build, `cargo fmt --check`, `cargo check`, `cargo test`, Mock Agent 브라우저 flow를 검증했습니다. `npm run tauri build -- --bundles app`은 17.29 MiB `Local LLM.app` 생성을 통과했고, Finder AppleEvent를 사용하지 않는 `CI=true npm run tauri build`는 17.29 MiB `.app`과 6.16 MiB `.dmg`를 모두 생성했습니다. 대화형 기본 DMG 명령은 이 호스트의 Finder AppleEvent 단계에서 실패할 수 있습니다. 실제 Keychain password 저장은 별도 credential 입력 시 검증합니다.
