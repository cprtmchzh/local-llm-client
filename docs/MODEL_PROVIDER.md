# Model and Runtime Providers

## Contracts

- `WakeProvider`: 원격 host를 깨웁니다.
- `ConnectionProvider`: reachability, authentication, command execution을 담당합니다.
- `RuntimeProvider`: health, start, stop, restart를 담당합니다.
- `ModelProvider`: model health와 streaming chat을 담당합니다.

## Registry

`config/models.json`의 model은 `launchProfileId`로 `config/launch-profiles.json`을 참조합니다. model path와 runtime policy를 분리해 같은 실행 정책을 여러 모델이 공유할 수 있습니다.

```json
{
  "id": "my-model",
  "name": "My Model",
  "category": "general",
  "runtimeId": "llama-cpp",
  "modelPath": "C:\\models\\my-model.gguf",
  "contextLength": 32768,
  "launchProfileId": "balanced",
  "description": "개인 모델"
}
```

OpenAI-compatible endpoint는 `POST /chat/completions`의 SSE `data:` frame과 `choices[0].delta.content`, `[DONE]`을 지원해야 합니다. llama.cpp server, LM Studio, Ollama 호환 endpoint 등은 각 구현의 URL/모델명을 profile에 맞춰 등록합니다.

런타임 명령은 사용자 소유의 고급 설정입니다. repository에 포함되는 profile에는 secret을 넣지 않으며 모델 path 등 허용 placeholder만 치환합니다.
