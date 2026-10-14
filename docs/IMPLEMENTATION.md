# Agent Desktop Core Implementation

## 완료

1. Tauri 2/React/TypeScript skeleton과 strict type checking
2. 반응형 chat/sidebar/settings/advanced log UI
3. Model Registry와 launch profile JSON
4. bounded retry 기반 connection state machine
5. Mock Wake/SSH/Runtime/Model providers
6. UDP Magic Packet, custom wake executable adapter
7. SSH key/password authentication과 Keychain secret storage
8. runtime start/stop/health adapters
9. OpenAI-compatible SSE streaming
10. local conversation/settings persistence와 오류 복구 UI
11. domain/orchestrator/component tests
12. temporary-port SSH local forwarding for health and SSE
13. app-owned runtime PID/model/port lifecycle and crash detection
14. typed executable/argv profiles with legacy JSON migration
15. persisted workspace domain and canonical path validation
16. ToolProvider types plus Mock/Workspace implementations
17. bounded file list/read/search/metadata tools
18. structured local/SSH shell results with non-zero exit as data
19. checked atomic unified patch application and diff metadata
20. independent AgentOrchestrator and normalized OpenAI/Qwen adapter
21. max step/tool/failure/runtime budgets and cancellation
22. AUTO/ASK/DENY approval policy
23. Chat-preserving Agent UI with projects/files/runs/activity/diff/output

## 기술적 위험

| 위험 | 현재 대응 | 다음 조치 |
|---|---|---|
| Router가 directed broadcast를 차단 | provider 분리, custom wake 지원 | VPN/ipTIME adapter 실기기 검증 |
| Windows SSH 서비스 부팅 지연 | TCP probe + 제한 retry/backoff | 실제 부팅 시간으로 정책 튜닝 |
| runtime 중복 실행 | PID/model/port registry와 app ownership 확인 | 재시작 후 signed ownership marker |
| API port 노출 | localhost bind + SSH local forwarding | host key pinning UI |
| 큰 대화의 localStorage 한계 | versioned storage API 격리 | SQLite migration |
| 모델마다 SSE 변형 | OpenAI-compatible parser | adapter별 conformance test |
| 원격 명령 injection | typed launch argv, placeholder validation, policy | signed executable allowlist 강화 |

## 다음 마일스톤

1. SQLite conversation/agent run repository와 migration
2. patch revert journal and Accept/Revert state
3. advanced context manager and token accounting
4. model/profile CRUD와 validation
5. GPU/VRAM telemetry (`nvidia-smi` structured query)
6. PTY, browser tools, MCP and multi-agent (core completion 이후)
