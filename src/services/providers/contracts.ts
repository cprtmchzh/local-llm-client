import type { AgentResponse } from "../../domain/agent";
import type { ShellResult } from "../../domain/tools";
import type { ChatRequest, ProviderContext, RuntimeInstance } from "../../domain/types";

export interface WakeProvider {
  wake(context: ProviderContext): Promise<void>;
}

export interface ConnectionProvider {
  isReachable(context: ProviderContext): Promise<boolean>;
  connect(context: ProviderContext): Promise<void>;
  disconnect(): Promise<void>;
  execute(context: ProviderContext, command: string, timeoutMs?: number): Promise<ShellResult>;
  apiBaseUrl(context: ProviderContext): string;
}

export interface RuntimeProvider {
  isRunning(context: ProviderContext): Promise<boolean>;
  start(context: ProviderContext): Promise<void>;
  stop(context: ProviderContext): Promise<void>;
  restart(context: ProviderContext): Promise<void>;
  instance(context: ProviderContext): Promise<RuntimeInstance | null>;
}

export interface ModelProvider {
  isHealthy(context: ProviderContext): Promise<boolean>;
  streamChat(request: ChatRequest, onToken: (token: string) => void): Promise<void>;
  completeAgent(context: ProviderContext, task: string, steps: unknown[], tools: unknown[]): Promise<AgentResponse>;
}

export interface ProviderBundle {
  wake: WakeProvider;
  connection: ConnectionProvider;
  runtime: RuntimeProvider;
  model: ModelProvider;
}
