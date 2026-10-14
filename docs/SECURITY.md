# Security Model

## Trust boundaries

React WebView는 일반 설정과 UI 상태만 다룹니다. 네트워크, SSH, OS credential은 Tauri IPC 뒤의 Rust backend가 담당합니다. SSH 암호는 macOS Keychain에 저장되고 React state에는 입력 직후 이후 유지하지 않습니다.

## 적용된 통제

- password/API key/private key를 source/config/log에 저장하지 않음
- Keychain service allowlist로 임의 credential namespace 쓰기 차단
- custom wake는 shell을 사용하지 않고 절대경로 executable + parsed argv만 허용
- TCP/HTTP/SSH timeout 및 bounded retry
- CSP로 WebView outbound request 차단; backend만 모델 API 접근
- `.env`, private key, DB, build artifact git 제외
- remote command 최대 길이 제한, 기술 로그에서 secret 제외

## 운영 권장 사항

- 모델 API/SSH는 인터넷에 port-forward하지 않고 WireGuard/Tailscale 또는 신뢰 LAN을 사용합니다.
- Windows 방화벽은 Mac/VPN subnet만 허용합니다.
- SSH password보다 passphrase가 있는 Ed25519 key를 우선합니다.
- 모델 파일 및 runtime executable의 hash/source를 검증합니다.
- Windows 사용자에게 관리자 권한을 부여하지 않습니다.

## 남은 보안 작업

현재 모델 API는 Mac에서 Windows host/port로 직접 접근합니다. 다음 릴리스에서 SSH local port forwarding을 기본으로 바꾸고, launch command를 문자열 대신 typed executable/argv allowlist로 전환해야 합니다. Windows 실기기 threat model과 dependency audit도 릴리스 전에 필요합니다.
