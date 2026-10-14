# Testing

## 자동 검증

```bash
npm test
npm run build
```

현재 suite는 상태 전이, offline wake에서 model ready까지 orchestration, model selector의 접근 가능한 listbox 동작을 검증합니다. TypeScript production build는 strict typing과 Vite bundling을 함께 확인합니다.

Rust가 설치된 환경에서는 다음을 추가합니다.

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

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

macOS ARM64 환경에서 `cargo check`, release `.app` bundle, `/Applications` 설치, 앱 실행, Mock 연결/streaming E2E를 검증했습니다. Windows 실기기 연결과 실제 Keychain credential 저장은 아직 미검증입니다.
