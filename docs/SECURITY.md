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
- 모델 API는 임시 `127.0.0.1` 포트에서 SSH local forwarding을 기본 사용
- runtime stop은 현재 앱 세션이 시작하고 PID/model/port가 일치하는 process만 허용
- launch profile은 executable/argv 단위 치환과 placeholder 검증 사용
- workspace path canonicalization으로 absolute path, `..`, symlink escape 차단
- file size/search result/tool output 제한과 binary file 거부
- patch는 대상 경계를 검증하고 `git apply --check` 후 원자적으로 적용
- tool policy의 `AUTO/ASK/DENY`, shutdown 거부, push/delete 승인 요구
- agent step/tool/failure/runtime budget과 AbortSignal cancel

## 운영 권장 사항

- 모델 API/SSH는 인터넷에 port-forward하지 않고 WireGuard/Tailscale 또는 신뢰 LAN을 사용합니다.
- Windows 방화벽은 Mac/VPN subnet만 허용합니다.
- SSH password보다 passphrase가 있는 Ed25519 key를 우선합니다.
- 모델 파일 및 runtime executable의 hash/source를 검증합니다.
- Windows 사용자에게 관리자 권한을 부여하지 않습니다.

## Direct API debug mode

Settings의 `Direct LAN API (Debug)`를 켜면 tunnel을 우회합니다. 이 옵션은 신뢰 LAN에서만 사용하고 배포 기본값은 항상 꺼짐입니다.

## 남은 보안 작업

Windows host key pinning UI, signed runtime allowlist, patch revert journal, dependency audit, Windows 실기기 threat model을 릴리스 전에 추가해야 합니다. 현재 SSH 라이브러리는 서버 key를 연결 설정에 pinning하지 않습니다.
