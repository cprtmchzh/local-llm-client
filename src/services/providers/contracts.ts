import type { AgentResponse } from "../../domain/agent";
import type { ShellResult } from "../../domain/tools";
import type { ChatRequest, Citation, ProviderContext, RuntimeInstance } from "../../domain/types";

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
  streamChat(request: ChatRequest, onToken: (token: string) => void, signal?: AbortSignal): Promise<void>;
  completeChat(request: ChatRequest, signal?: AbortSignal): Promise<string>;
  completeAgent(context: ProviderContext, task: string, steps: unknown[], tools: unknown[]): Promise<AgentResponse>;
}

export interface SearchRequest {
  requestId: string;
  query: string;
  maxResults: number;
  timeoutMs: number;
}

export interface SearchProvider {
  search(request: SearchRequest, signal?: AbortSignal): Promise<Citation[]>;
}

export interface ProviderBundle {
  wake: WakeProvider;
  connection: ConnectionProvider;
  runtime: RuntimeProvider;
  model: ModelProvider;
  search: SearchProvider;
}
