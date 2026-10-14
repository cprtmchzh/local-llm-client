# MVP Implementation

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

## 기술적 위험

| 위험 | 현재 대응 | 다음 조치 |
|---|---|---|
| Router가 directed broadcast를 차단 | provider 분리, custom wake 지원 | VPN/ipTIME adapter 실기기 검증 |
| Windows SSH 서비스 부팅 지연 | TCP probe + 제한 retry/backoff | 실제 부팅 시간으로 정책 튜닝 |
| runtime 중복 실행 | health check 후에만 start | PID/Windows service 기반 ownership |
| API port 노출 | 사설 LAN/VPN + firewall 문서화 | SSH local forwarding |
| 큰 대화의 localStorage 한계 | versioned storage API 격리 | SQLite migration |
| 모델마다 SSE 변형 | OpenAI-compatible parser | adapter별 conformance test |
| 원격 명령 injection | UI 비노출, command 길이/credential service 제한 | typed launch argv와 allowlist 강화 |

## 다음 마일스톤

1. Windows 실기기 E2E 및 SSH tunnel
2. SQLite conversation repository와 migration
3. runtime PID/service lifecycle 및 crash recovery
4. model/profile CRUD와 validation
5. GPU/VRAM telemetry (`nvidia-smi` structured query)
6. app close policy와 sleep 명령 연결
