import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ChatRequest, ProviderContext } from "../../domain/types";
import type {
  ConnectionProvider,
  ModelProvider,
  ProviderBundle,
  RuntimeProvider,
  WakeProvider,
} from "./contracts";

function connectionArgs(context: ProviderContext) {
  return {
    host: context.settings.host,
    port: context.settings.sshPort,
    username: context.settings.username,
    authentication: context.settings.authentication,
    privateKeyPath: context.settings.privateKeyPath,
  };
}

function apiBaseUrl(context: ProviderContext): string {
  return context.profile.apiBaseUrl.replaceAll("{host}", context.settings.host);
}

class TauriWakeProvider implements WakeProvider {
  async wake(context: ProviderContext): Promise<void> {
    if (context.settings.wakeProvider === "custom") {
      await invoke("execute_custom_wake", { command: context.settings.customWakeCommand });
      return;
    }
    await invoke("send_magic_packet", {
      macAddress: context.settings.macAddress,
      broadcastAddress: context.settings.broadcastAddress,
    });
  }
}

class TauriConnectionProvider implements ConnectionProvider {
  async isReachable(context: ProviderContext): Promise<boolean> {
    return invoke<boolean>("check_host", {
      host: context.settings.host,
      port: context.settings.sshPort,
      timeoutMs: 1_500,
    });
  }

  async connect(context: ProviderContext): Promise<void> {
    await invoke("check_ssh", connectionArgs(context));
  }

  async disconnect(): Promise<void> {
    // SSH sessions are short-lived by design; no persistent socket contains credentials.
  }

  async execute(context: ProviderContext, command: string): Promise<string> {
    return invoke<string>("execute_ssh", { ...connectionArgs(context), command });
  }
}

function renderCommand(context: ProviderContext): string {
  const values: Record<string, string> = {
    modelPath: context.model.modelPath,
    contextSize: String(context.profile.contextSize),
    gpuLayers: String(context.profile.gpuLayers),
    threads: String(context.profile.threads),
    batchSize: String(context.profile.batchSize),
    port: String(context.profile.port),
  };
  return Object.entries(values).reduce(
    (command, [key, value]) => command.replaceAll(`{${key}}`, value),
    context.profile.command,
  );
}

class TauriRuntimeProvider implements RuntimeProvider {
  constructor(private readonly connection: TauriConnectionProvider) {}

  async isRunning(context: ProviderContext): Promise<boolean> {
    return invoke<boolean>("check_http_health", {
      url: `${apiBaseUrl(context).replace(/\/v1$/, "")}${context.profile.healthEndpoint}`,
      timeoutMs: 1_500,
    });
  }

  async start(context: ProviderContext): Promise<void> {
    const command = renderCommand(context);
    if (!command) return;
    await this.connection.execute(
      context,
      `powershell -NoProfile -NonInteractive -Command "Start-Process -WindowStyle Hidden -FilePath 'cmd.exe' -ArgumentList '/c ${command.replaceAll('"', '\\"')}'"`,
    );
  }

  async stop(context: ProviderContext): Promise<void> {
    await this.connection.execute(
      context,
      `powershell -NoProfile -NonInteractive -Command "Get-NetTCPConnection -LocalPort ${context.profile.port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Stop-Process -Force"`,
    );
  }

  async restart(context: ProviderContext): Promise<void> {
    await this.stop(context);
    await this.start(context);
  }
}

class TauriModelProvider implements ModelProvider {
  async isHealthy(context: ProviderContext): Promise<boolean> {
    return invoke<boolean>("check_http_health", {
      url: `${apiBaseUrl(context).replace(/\/v1$/, "")}${context.profile.healthEndpoint}`,
      timeoutMs: 2_000,
    });
  }

  async streamChat(request: ChatRequest, onToken: (token: string) => void): Promise<void> {
    const tokenEvent = `chat://token/${request.requestId}`;
    const doneEvent = `chat://done/${request.requestId}`;
    const errorEvent = `chat://error/${request.requestId}`;

    await new Promise<void>((resolve, reject) => {
      const cleanups: Array<() => void> = [];
      const cleanup = () => cleanups.splice(0).forEach((dispose) => dispose());

      Promise.all([
        listen<string>(tokenEvent, (event) => onToken(event.payload)),
        listen(doneEvent, () => {
          cleanup();
          resolve();
        }),
        listen<string>(errorEvent, (event) => {
          cleanup();
          reject(new Error(event.payload));
        }),
      ])
        .then((unlisteners) => {
          cleanups.push(...unlisteners);
          return invoke("stream_chat", { request });
        })
        .catch((error: unknown) => {
          cleanup();
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }
}

export function createTauriProviders(): ProviderBundle {
  const connection = new TauriConnectionProvider();
  return {
    wake: new TauriWakeProvider(),
    connection,
    runtime: new TauriRuntimeProvider(connection),
    model: new TauriModelProvider(),
  };
}
