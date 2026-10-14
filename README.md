# Local LLM Client

원격 Windows PC에서 실행되는 Local LLM을 인프라 조작 없이 선택하고 대화하기 위한 macOS 데스크톱 클라이언트입니다. Tauri 2, Rust, React, TypeScript로 구성되며 현재 MVP는 Mock Mode 전체 흐름과 실제 Magic Packet/SSH/OpenAI 호환 런타임 연결을 제공합니다.

## 현재 구현 상태

- ChatGPT 스타일 대화 UI, 모델 선택, Markdown/GFM, 코드 복사, token streaming
- `OFFLINE → WAKING → SSH_READY → MODEL_READY` 상태 머신과 제한된 재시도/backoff
- Magic Packet WOL 및 절대경로 기반 Custom Wake adapter
- SSH 개인 키/Keychain 암호 인증, 원격 명령 실행
- SSH local port forwarding을 통한 health/SSE 접근(Direct LAN은 debug opt-in)
- process ownership/PID 기반 runtime lifecycle과 typed executable/argv launch profile
- llama.cpp, Ollama 및 OpenAI-compatible API health check/SSE chat
- Workspace/recent workspace, 경계 검증, read/search/metadata/atomic patch 도구
- AgentOrchestrator, Qwen/OpenAI tool-call adapter, budget/cancel/approval policy
- Chat을 유지하는 Agent activity/diff/tool output UI
- Model Registry/Launch Profile, 대화/workspace/일반 설정 로컬 저장
- Mock Provider로 Windows 없이 wake/SSH/runtime/model/streaming 전체 과정 재현
- 상세 로그와 사용자 복구 액션

## 빠른 시작

요구사항: Node.js 20+, npm 10+. 데스크톱 앱 빌드에는 [Rust](https://rustup.rs/)와 Tauri 2 시스템 요구사항이 추가로 필요합니다.

```bash
npm install
npm run dev
```

브라우저 개발 모드에서는 Settings → Application의 `Mock Mode`를 켭니다. macOS 네이티브 앱은 Rust 설치 후 실행합니다.

```bash
npm run tauri dev
```

검증 명령:

```bash
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run test:e2e:windows -- --target user@windows-host --model qwen3:8b
```

## 실제 Windows 연결

1. Windows의 OpenSSH Server를 활성화하고 Mac의 공개 키를 `%USERPROFILE%\.ssh\authorized_keys`에 등록합니다.
2. Windows Defender Firewall에서 SSH 포트만 신뢰할 수 있는 사설망/VPN에 허용합니다. 모델 API는 Windows localhost에 바인딩합니다.
3. BIOS/UEFI와 NIC 전원 관리에서 Wake-on-LAN을 활성화합니다.
4. 앱 Settings에서 host, SSH port, username, private key 경로, MAC 주소와 broadcast 주소를 입력합니다.
5. `config/models.json`의 모델 경로 및 `config/launch-profiles.json`의 typed `launch.executable`/`launch.args`를 실제 Windows 환경에 맞춥니다. 실행 중인 Ollama는 `ollama-agent` 프로필을 사용할 수 있습니다.
6. Mock Mode를 끄고 상단의 다시 연결 버튼을 누릅니다.

llama-server/Ollama는 Windows `127.0.0.1`에만 바인딩할 수 있습니다. 앱은 임시 Mac localhost 포트를 열고 SSH tunnel을 통해 health와 streaming 요청을 전달합니다. Settings의 Direct LAN API는 디버그용 opt-in입니다.

## 모델 추가

[`config/models.json`](config/models.json)에 모델을 등록하고 [`config/launch-profiles.json`](config/launch-profiles.json)의 프로필 ID를 연결합니다. launch는 `executable`과 `args[]`로 분리됩니다. 지원 placeholder는 `{modelPath}`, `{contextSize}`, `{gpuLayers}`, `{threads}`, `{batchSize}`, `{port}`이며 API URL에는 `{host}`를 사용할 수 있습니다. 자격 증명은 이 파일에 넣지 않습니다.

## 저장과 보안

일반 설정, registry snapshot, 대화는 현재 WebView localStorage에 저장됩니다. SSH 암호는 Rust backend를 거쳐 macOS Keychain의 `local-llm-client.ssh` service에 저장되며 설정/로그에는 기록되지 않습니다. 민감 파일, `.env`, 개인 키, DB 파일은 `.gitignore`에서 제외됩니다.

## 문서

- [Architecture](docs/ARCHITECTURE.md)
- [Implementation](docs/IMPLEMENTATION.md)
- [Connection flow](docs/CONNECTION_FLOW.md)
- [Model providers](docs/MODEL_PROVIDER.md)
- [Security](docs/SECURITY.md)
- [Testing](docs/TESTING.md)

## Troubleshooting

- `cargo: command not found`: `rustup`으로 Rust stable을 설치하고 새 터미널을 엽니다.
- WOL timeout: 같은 LAN/VPN에서 broadcast가 전달되는지, BIOS/NIC 설정과 MAC 주소를 확인합니다.
- SSH authentication failed: Windows OpenSSH의 `authorized_keys` 권한과 앱의 Keychain 항목/키 경로를 확인합니다.
- Model health timeout: Windows에서 runtime process, bind address, 포트, 방화벽, `/health` 응답을 확인합니다.
- 응답 중단: Advanced Mode 로그를 열고 모델 API의 SSE 호환 여부를 확인한 뒤 재연결합니다.

## 알려진 제한

- macOS ARM64에서 Rust/Tauri native compile, release `.app` bundle, 설치 및 Mock E2E를 검증했습니다. 실제 Keychain 암호 저장은 실사용 credential 입력 시 별도 검증이 필요합니다.
- conversation persistence는 MVP에서 localStorage이며, SQLite migration은 다음 단계입니다.
- model/launch profile 편집은 JSON 기반이며 앱 내 편집 UI는 아직 없습니다.
- Agent run 영구 저장, advanced context manager, PTY, MCP와 multi-agent는 아직 구현하지 않았습니다.
- Diff는 Accept/Revert 결정을 지원하며 revert도 사전 검사 후 reverse patch로 원자 적용합니다.

다음 우선순위는 SQLite agent persistence, context manager, Revert history, model/profile 편집 UI입니다.
