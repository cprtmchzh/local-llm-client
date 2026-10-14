# Connection Flow

```mermaid
sequenceDiagram
  actor User
  participant UI
  participant Orchestrator
  participant Wake
  participant SSH
  participant Runtime
  participant Model
  User->>UI: Send message / select model
  UI->>Orchestrator: prepare(context)
  Orchestrator->>SSH: TCP reachability check
  alt host offline
    Orchestrator->>Wake: Magic Packet
    loop bounded retry
      Orchestrator->>SSH: reachability check
    end
  end
  Orchestrator->>SSH: authenticate
  SSH->>SSH: bind temporary 127.0.0.1 port
  SSH->>Runtime: forward to Windows 127.0.0.1:runtime-port
  Orchestrator->>Runtime: health check
  alt runtime stopped
    Orchestrator->>Runtime: start selected launch profile
  end
  loop bounded retry
    Orchestrator->>Model: API health check
  end
  Orchestrator-->>UI: MODEL_READY
  UI->>Model: stream chat
  Model-->>UI: token events
```

Mock Mode는 동일한 sequence를 짧은 지연과 메모리 상태로 재현합니다. 실제 모드는 Tauri IPC를 통해 Rust backend만 network/credential에 접근합니다.

Tunnel은 연결 준비 시 stale listener를 정리하고 다시 생성합니다. health check와 SSE chat은 동일한 tunnel base URL을 사용하며 Windows LAN API 주소로 직접 요청하지 않습니다. Direct LAN mode는 명시적인 debug 설정에서만 사용합니다.

모델 변경 시 conversation은 유지하고 이후 요청부터 새 `modelId`를 사용합니다. 현재 컨텍스트는 이전 user/assistant messages 전체를 새 모델로 전달합니다. production 단계에서는 context window token budgeting과 system notice가 추가되어야 합니다.
