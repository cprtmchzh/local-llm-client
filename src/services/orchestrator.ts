import { AppError, type ConnectionState, type ProviderContext } from "../domain/types";
import { retry } from "../lib/retry";
import { sleep } from "../lib/utils";
import type { ProviderBundle } from "./providers/contracts";

export interface OrchestrationHooks {
  setState: (state: ConnectionState) => void;
  log: (message: string, level?: "info" | "warn" | "error" | "debug") => void;
}

export class ConnectionOrchestrator {
  constructor(
    private readonly providers: ProviderBundle,
    private readonly hooks: OrchestrationHooks,
  ) {}

  async prepare(context: ProviderContext): Promise<void> {
    try {
      let reachable = await this.providers.connection.isReachable(context);
      if (!reachable) {
        this.hooks.setState("waking");
        this.hooks.log("Windows host is offline; wake sequence started");
        await this.providers.wake.wake(context);
        reachable = await retry(() => this.requireReachable(context), {
          attempts: context.settings.mockMode ? 3 : 12,
          initialDelayMs: context.settings.mockMode ? 120 : 2_000,
          factor: 1.25,
          onRetry: (attempt) => this.hooks.log(`Waiting for host (attempt ${attempt})`, "debug"),
        });
      }

      if (!reachable) {
        throw new AppError(
          "Windows PC를 깨우지 못했습니다.",
          "WAKE_FAILED",
          "네트워크와 WOL 설정을 확인한 뒤 다시 시도하세요.",
        );
      }

      this.hooks.setState("online");
      this.hooks.log("Windows host reachable");
      this.hooks.setState("ssh_connecting");
      await retry(() => this.providers.connection.connect(context), {
        attempts: context.settings.mockMode ? 2 : 5,
        initialDelayMs: context.settings.mockMode ? 100 : 1_000,
        onRetry: (attempt) => this.hooks.log(`SSH reconnect attempt ${attempt}`, "warn"),
      });

      this.hooks.setState("ssh_ready");
      this.hooks.log("SSH connected");

      if (!(await this.providers.runtime.isRunning(context))) {
        this.hooks.setState("runtime_starting");
        this.hooks.log(`Runtime ${context.profile.runtimeId} starting`);
        await this.providers.runtime.start(context);
      }

      this.hooks.setState("model_loading");
      this.hooks.log(`Model ${context.model.id} loading`);
      await retry(() => this.requireHealthy(context), {
        attempts: context.settings.mockMode ? 3 : 30,
        initialDelayMs: context.settings.mockMode ? 100 : 1_500,
        factor: 1.12,
        onRetry: (attempt) => this.hooks.log(`Model health check ${attempt}`, "debug"),
      });

      this.hooks.setState("model_ready");
      this.hooks.log(`Model ${context.model.id} ready`);
    } catch (error) {
      this.hooks.setState("error");
      this.hooks.log(error instanceof Error ? error.message : String(error), "error");
      if (error instanceof AppError) throw error;
      throw new AppError(
        error instanceof Error ? error.message : "연결 중 알 수 없는 오류가 발생했습니다.",
        "UNKNOWN",
        "다시 연결하거나 상세 로그를 확인하세요.",
      );
    }
  }

  private async requireReachable(context: ProviderContext): Promise<boolean> {
    const reachable = await this.providers.connection.isReachable(context);
    if (!reachable) throw new Error("Host not reachable yet");
    return true;
  }

  private async requireHealthy(context: ProviderContext): Promise<boolean> {
    const healthy = await this.providers.model.isHealthy(context);
    if (!healthy) {
      await sleep(50);
      throw new Error("Model API not ready yet");
    }
    return true;
  }
}
