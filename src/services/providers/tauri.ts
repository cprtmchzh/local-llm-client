import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AgentResponse } from "../../domain/agent";
import { renderLaunchCommand } from "../../domain/launchCommand";
import type { ShellResult } from "../../domain/tools";
import type { ChatRequest, Citation, ProviderContext, RuntimeInstance } from "../../domain/types";
import { normalizeOpenAiAgentResponse, qwenToolsPrompt } from "../modelAdapter";
import type { ConnectionProvider, ModelProvider, ProviderBundle, RuntimeProvider, SearchProvider, SearchRequest, WakeProvider } from "./contracts";

function cancelled(): DOMException {
  return new DOMException("Cancelled", "AbortError");
}

function invokeWithCancellation<T>(
  command: string,
  args: Record<string, unknown>,
  signal: AbortSignal | undefined,
  cancelCommand: string,
  requestId: string,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(cancelled());
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      void invoke(cancelCommand, { requestId }).catch(() => undefined);
      reject(cancelled());
    };
    signal?.addEventListener("abort", abort, { once: true });
    invoke<T>(command, args).then(resolve, reject).finally(() => signal?.removeEventListener("abort", abort));
  });
}

function connectionArgs(context: ProviderContext) {
  return { host: context.settings.host, port: context.settings.sshPort, username: context.settings.username, authentication: context.settings.authentication, privateKeyPath: context.settings.privateKeyPath };
}

function directApiBaseUrl(context: ProviderContext): string {
  return context.profile.apiBaseUrl.replaceAll("{host}", context.settings.host);
}

interface TunnelInfo { id: string; localPort: number; remotePort: number }

class TauriWakeProvider implements WakeProvider {
  async wake(context: ProviderContext): Promise<void> {
    if (context.settings.wakeProvider === "custom") {
      await invoke("execute_custom_wake", { command: context.settings.customWakeCommand });
      return;
    }
    await invoke("send_magic_packet", { macAddress: context.settings.macAddress, broadcastAddress: context.settings.broadcastAddress });
  }
}

class TauriConnectionProvider implements ConnectionProvider {
  private readonly tunnels = new Map<string, TunnelInfo>();
  private readonly searchTunnels = new Map<string, TunnelInfo>();

  private tunnelKey(context: ProviderContext): string {
    return `${context.settings.username}@${context.settings.host}:${context.settings.sshPort}/${context.profile.port}`;
  }

  private searchTunnelKey(context: ProviderContext, remotePort: number): string {
    return `${context.settings.username}@${context.settings.host}:${context.settings.sshPort}/search/${remotePort}`;
  }

  private remoteSearxngUrl(context: ProviderContext): URL | null {
    if (context.settings.searchProvider === "tavily") return null;
    let url: URL;
    try {
      url = new URL(context.settings.searxngBaseUrl);
    } catch {
      return null;
    }
    return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ? url : null;
  }

  private async ensureSearchTunnel(context: ProviderContext): Promise<TunnelInfo | null> {
    const remoteUrl = this.remoteSearxngUrl(context);
    if (!remoteUrl) return null;
    const remotePort = Number(remoteUrl.port || (remoteUrl.protocol === "https:" ? 443 : 80));
    if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) {
      throw new Error("Windows SearXNG port is invalid");
    }
    const key = this.searchTunnelKey(context, remotePort);
    const existing = this.searchTunnels.get(key);
    if (existing) return existing;
    const tunnel = await invoke<TunnelInfo>("start_ssh_tunnel", {
      connection: connectionArgs(context),
      remotePort,
    });
    this.searchTunnels.set(key, tunnel);
    return tunnel;
  }

  async searxngBaseUrl(context: ProviderContext): Promise<string> {
    const remoteUrl = this.remoteSearxngUrl(context);
    if (!remoteUrl) return context.settings.searxngBaseUrl;
    const tunnel = await this.ensureSearchTunnel(context);
    if (!tunnel) return context.settings.searxngBaseUrl;
    remoteUrl.protocol = "http:";
    remoteUrl.hostname = "127.0.0.1";
    remoteUrl.port = String(tunnel.localPort);
    return remoteUrl.toString().replace(/\/$/, "");
  }

  async isReachable(context: ProviderContext): Promise<boolean> {
    return invoke<boolean>("check_host", { host: context.settings.host, port: context.settings.sshPort, timeoutMs: 1_500 });
  }

  async connect(context: ProviderContext): Promise<void> {
    await invoke("check_ssh", { connection: connectionArgs(context) });
    if (!context.settings.directApiMode) {
      const key = this.tunnelKey(context);
      const stale = this.tunnels.get(key);
      if (stale) await invoke("stop_ssh_tunnel", { tunnelId: stale.id });
      const tunnel = await invoke<TunnelInfo>("start_ssh_tunnel", { connection: connectionArgs(context), remotePort: context.profile.port });
      this.tunnels.set(key, tunnel);
      await this.ensureSearchTunnel(context);
    }
  }

  async disconnect(): Promise<void> {
    await Promise.all([...this.tunnels.values(), ...this.searchTunnels.values()].map((tunnel) => invoke("stop_ssh_tunnel", { tunnelId: tunnel.id })));
    this.tunnels.clear();
    this.searchTunnels.clear();
  }

  async execute(context: ProviderContext, command: string, timeoutMs = 120_000): Promise<ShellResult> {
    return invoke<ShellResult>("execute_ssh", { connection: connectionArgs(context), command, timeoutMs });
  }

  apiBaseUrl(context: ProviderContext): string {
    if (context.settings.directApiMode) return directApiBaseUrl(context);
    const tunnel = this.tunnels.get(this.tunnelKey(context));
    if (!tunnel) throw new Error("SSH model API tunnel is not connected");
    return `http://127.0.0.1:${tunnel.localPort}/v1`;
  }
}

class TauriRuntimeProvider implements RuntimeProvider {
  constructor(private readonly connection: TauriConnectionProvider) {}

  async isRunning(context: ProviderContext): Promise<boolean> {
    const owned = await this.instance(context);
    if (owned?.status === "running") return true;
    return invoke<boolean>("check_http_health", { url: `${this.connection.apiBaseUrl(context).replace(/\/v1$/, "")}${context.profile.healthEndpoint}`, timeoutMs: 1_500 });
  }

  async start(context: ProviderContext): Promise<void> {
    if (!context.profile.launch) return;
    const launch = renderLaunchCommand(context.profile.launch, context);
    await invoke<RuntimeInstance>("start_remote_runtime", { connection: connectionArgs(context), executable: launch.executable, args: launch.args, modelId: context.model.id, port: context.profile.port });
  }

  async stop(context: ProviderContext): Promise<void> {
    const instance = await this.instance(context);
    if (!instance?.ownedByApp) return;
    await invoke("stop_remote_runtime", { connection: connectionArgs(context), pid: instance.pid, modelId: instance.modelId, port: instance.port });
  }

  async restart(context: ProviderContext): Promise<void> {
    await this.stop(context);
    await this.start(context);
  }

  async instance(context: ProviderContext): Promise<RuntimeInstance | null> {
    return invoke<RuntimeInstance | null>("inspect_remote_runtime", { connection: connectionArgs(context), modelId: context.model.id, port: context.profile.port });
  }
}

class TauriModelProvider implements ModelProvider {
  constructor(private readonly connection: TauriConnectionProvider) {}

  private visibleOutputRequest(request: ChatRequest): ChatRequest {
    const messages = [...request.messages];
    const instruction = "The analysis is complete. Write only the polished final answer now. Do not include hidden reasoning or an analysis preamble.";
    if (messages[0]?.role === "system") {
      messages[0] = { ...messages[0], content: `${messages[0].content}\n\n${instruction}` };
    } else {
      messages.unshift({ role: "system", content: instruction });
    }
    return {
      ...request,
      requestId: `${request.requestId}:visible`,
      maxTokens: Math.min(request.maxTokens, 1_024),
      reasoningEffort: "none",
      messages,
    };
  }

  async isHealthy(context: ProviderContext): Promise<boolean> {
    return invoke<boolean>("check_http_health", { url: `${this.connection.apiBaseUrl(context).replace(/\/v1$/, "")}${context.profile.healthEndpoint}`, timeoutMs: 2_000 });
  }

  async streamChat(request: ChatRequest, onToken: (token: string) => void, signal?: AbortSignal): Promise<void> {
    let visibleContent = "";
    const emitVisible = (token: string) => {
      visibleContent += token;
      onToken(token);
    };
    await this.streamChatOnce(request, emitVisible, () => undefined, signal);
    if (visibleContent.trim()) return;
    await this.streamChatOnce(this.visibleOutputRequest(request), emitVisible, () => undefined, signal);
    if (!visibleContent.trim()) throw new Error("model response did not contain visible content");
  }

  private async streamChatOnce(
    request: ChatRequest,
    onToken: (token: string) => void,
    onReasoning: (token: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) throw cancelled();
    const tokenEvent = `chat://token/${request.requestId}`;
    const reasoningEvent = `chat://reasoning/${request.requestId}`;
    const doneEvent = `chat://done/${request.requestId}`;
    const errorEvent = `chat://error/${request.requestId}`;
    await new Promise<void>((resolve, reject) => {
      const cleanups: Array<() => void> = [];
      const cleanup = () => cleanups.splice(0).forEach((dispose) => dispose());
      let invoked = false;
      const abort = () => {
        if (invoked) void invoke("cancel_chat", { requestId: request.requestId }).catch(() => undefined);
        cleanup();
        reject(cancelled());
      };
      signal?.addEventListener("abort", abort, { once: true });
      cleanups.push(() => signal?.removeEventListener("abort", abort));
      Promise.all([
        listen<string>(tokenEvent, (event) => onToken(event.payload)),
        listen<string>(reasoningEvent, (event) => onReasoning(event.payload)),
        listen(doneEvent, () => { cleanup(); resolve(); }),
        listen<string>(errorEvent, (event) => { cleanup(); reject(new Error(event.payload)); }),
      ]).then((unlisteners) => {
        cleanups.push(...unlisteners);
        if (signal?.aborted) {
          cleanup();
          return;
        }
        invoked = true;
        return invoke("stream_chat", { request });
      }).catch((error: unknown) => { cleanup(); reject(error instanceof Error ? error : new Error(String(error))); });
    });
  }

  async completeChat(request: ChatRequest, signal?: AbortSignal): Promise<string> {
    // Internal Deep Review stages do not need UI streaming. Prefer an atomic
    // response containing both content and reasoning, then retry through SSE
    // for runtimes that only implement streaming reliably.
    try {
      const result = await invokeWithCancellation<string>(
        "complete_chat",
        { request },
        signal,
        "cancel_chat",
        request.requestId,
      );
      if (result.trim()) return result;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
    }
    let content = "";
    let reasoning = "";
    await this.streamChatOnce(
      request,
      (token) => { content += token; },
      (token) => { reasoning += token; },
      signal,
    );
    const result = content.trim() ? content : reasoning;
    if (!result.trim()) throw new Error("model response did not contain content or reasoning");
    return result;
  }

  async completeAgent(context: ProviderContext, task: string, steps: unknown[], tools: unknown[]): Promise<AgentResponse> {
    const names = tools.map((tool) => typeof tool === "string" ? tool : JSON.stringify(tool));
    const raw = await invoke<unknown>("complete_agent", { baseUrl: this.connection.apiBaseUrl(context), model: context.model.modelPath, temperature: context.profile.temperature, system: qwenToolsPrompt(names), task, steps, tools });
    return normalizeOpenAiAgentResponse(raw);
  }
}

class TauriSearchProvider implements SearchProvider {
  constructor(private readonly connection: TauriConnectionProvider) {}

  async search(request: SearchRequest, context: ProviderContext, signal?: AbortSignal): Promise<Citation[]> {
    const nativeRequest = {
      ...request,
      searxngBaseUrl: await this.connection.searxngBaseUrl(context),
    };
    return invokeWithCancellation<Citation[]>(
      "search_web",
      { request: nativeRequest },
      signal,
      "cancel_search",
      request.requestId,
    );
  }
}

export function createTauriProviders(): ProviderBundle {
  const connection = new TauriConnectionProvider();
  return {
    wake: new TauriWakeProvider(),
    connection,
    runtime: new TauriRuntimeProvider(connection),
    model: new TauriModelProvider(connection),
    search: new TauriSearchProvider(connection),
  };
}
