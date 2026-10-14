import type { ChatRequest, ProviderContext } from "../../domain/types";

export interface WakeProvider {
  wake(context: ProviderContext): Promise<void>;
}

export interface ConnectionProvider {
  isReachable(context: ProviderContext): Promise<boolean>;
  connect(context: ProviderContext): Promise<void>;
  disconnect(): Promise<void>;
  execute(context: ProviderContext, command: string): Promise<string>;
}

export interface RuntimeProvider {
  isRunning(context: ProviderContext): Promise<boolean>;
  start(context: ProviderContext): Promise<void>;
  stop(context: ProviderContext): Promise<void>;
  restart(context: ProviderContext): Promise<void>;
}

export interface ModelProvider {
  isHealthy(context: ProviderContext): Promise<boolean>;
  streamChat(request: ChatRequest, onToken: (token: string) => void): Promise<void>;
}

export interface ProviderBundle {
  wake: WakeProvider;
  connection: ConnectionProvider;
  runtime: RuntimeProvider;
  model: ModelProvider;
}
