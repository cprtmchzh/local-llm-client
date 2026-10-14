import type { AgentResponse } from "../../domain/agent";
import type { ShellResult } from "../../domain/tools";
import type { ChatRequest, ProviderContext, RuntimeInstance } from "../../domain/types";
import { sleep } from "../../lib/utils";
import type {
  ConnectionProvider,
  ModelProvider,
  ProviderBundle,
  RuntimeProvider,
  WakeProvider,
} from "./contracts";

class MockEnvironment {
  reachable = false;
  connected = false;
  runtimeRunning = false;
}

class MockWakeProvider implements WakeProvider {
  constructor(private readonly environment: MockEnvironment) {}

  async wake(): Promise<void> {
    await sleep(650);
    this.environment.reachable = true;
  }
}

class MockConnectionProvider implements ConnectionProvider {
  constructor(private readonly environment: MockEnvironment) {}

  async isReachable(): Promise<boolean> {
    await sleep(220);
    return this.environment.reachable;
  }

  async connect(): Promise<void> {
    await sleep(650);
    this.environment.connected = true;
  }

  async disconnect(): Promise<void> {
    this.environment.connected = false;
  }

  async execute(_context: ProviderContext, command: string): Promise<ShellResult> {
    await sleep(150);
    return { command, stdout: `Mock command completed: ${command}`, stderr: "", exitCode: 0, durationMs: 150, timedOut: false };
  }

  apiBaseUrl(context: ProviderContext): string {
    return context.profile.apiBaseUrl.replaceAll("{host}", context.settings.host);
  }
}

class MockRuntimeProvider implements RuntimeProvider {
  constructor(private readonly environment: MockEnvironment) {}

  async isRunning(): Promise<boolean> {
    await sleep(200);
    return this.environment.runtimeRunning;
  }

  async start(): Promise<void> {
    await sleep(900);
    this.environment.runtimeRunning = true;
  }

  async stop(): Promise<void> {
    await sleep(300);
    this.environment.runtimeRunning = false;
  }

  async restart(_context: ProviderContext): Promise<void> {
    await this.stop();
    await this.start();
  }

  async instance(context: ProviderContext): Promise<RuntimeInstance | null> {
    return this.environment.runtimeRunning ? { pid: 4242, modelId: context.model.id, port: context.profile.port, startedAt: new Date().toISOString(), status: "running", ownedByApp: true } : null;
  }
}

const demoAnswer = `물론입니다. 지금은 **Mock Mode**로 동작하고 있어요.

원격 Windows PC가 켜지고, SSH가 연결되고, 선택한 모델이 준비되는 전체 흐름을 시뮬레이션했습니다.

\`\`\`ts
const client = await LocalLlmClient.connect();
await client.chat({ stream: true });
\`\`\`

Settings에서 실제 연결 정보를 입력하고 Mock Mode를 끄면 동일한 UI가 실제 런타임 어댑터를 사용합니다.`;

class MockModelProvider implements ModelProvider {
  constructor(private readonly environment: MockEnvironment) {}

  async isHealthy(): Promise<boolean> {
    await sleep(450);
    return this.environment.runtimeRunning;
  }

  async streamChat(request: ChatRequest, onToken: (token: string) => void): Promise<void> {
    const prompt = request.messages.at(-1)?.content ?? "";
    const answer = prompt.toLowerCase().includes("owasp")
      ? `OWASP 관점에서 분석을 시작하겠습니다.\n\n1. **공격 표면 확인** — 인증, 입력 검증, 세션 경계를 먼저 파악합니다.\n2. **안전한 테스트 계획** — 허가된 환경에서만 재현하고 증거를 기록합니다.\n3. **우선순위화** — 악용 가능성과 영향도를 함께 평가합니다.\n\n현재는 Mock Mode이므로 실제 대상에 요청을 보내지는 않았습니다.`
      : demoAnswer;

    for (const token of answer.match(/.{1,5}/gs) ?? []) {
      await sleep(28);
      onToken(token);
    }
  }

  async completeAgent(_context: ProviderContext, task: string, steps: unknown[]): Promise<AgentResponse> {
    if (steps.length === 0) return { type: "tool_call", id: crypto.randomUUID(), tool: "list_directory", arguments: { path: "" } };
    return { type: "final", content: `Mock agent completed: ${task}` };
  }
}

export function createMockProviders(): ProviderBundle {
  const environment = new MockEnvironment();
  return {
    wake: new MockWakeProvider(environment),
    connection: new MockConnectionProvider(environment),
    runtime: new MockRuntimeProvider(environment),
    model: new MockModelProvider(environment),
  };
}
