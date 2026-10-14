import { describe, expect, it, vi } from "vitest";
import { defaultModels, defaultProfiles, defaultSettings } from "../domain/defaults";
import type { ConnectionState, ProviderContext } from "../domain/types";
import { ConnectionOrchestrator } from "./orchestrator";
import type { ProviderBundle } from "./providers/contracts";

function fixture(): { providers: ProviderBundle; context: ProviderContext } {
  let awake = false;
  let runtime = false;
  const context = {
    settings: { ...defaultSettings, mockMode: true },
    model: defaultModels[0],
    profile: defaultProfiles[0],
  };
  const providers: ProviderBundle = {
    wake: { wake: vi.fn(async () => { awake = true; }) },
    connection: {
      isReachable: vi.fn(async () => awake),
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      execute: vi.fn(async () => ({ command: "", stdout: "", stderr: "", exitCode: 0, durationMs: 0, timedOut: false })),
      apiBaseUrl: vi.fn(() => "http://127.0.0.1:8080/v1"),
    },
    runtime: {
      isRunning: vi.fn(async () => runtime),
      start: vi.fn(async () => { runtime = true; }),
      stop: vi.fn(async () => { runtime = false; }),
      restart: vi.fn(async () => undefined),
      instance: vi.fn(async () => null),
    },
    model: {
      isHealthy: vi.fn(async () => runtime),
      streamChat: vi.fn(async () => undefined),
      completeAgent: vi.fn(async () => ({ type: "final" as const, content: "done" })),
    },
  };
  return { providers, context };
}

describe("ConnectionOrchestrator", () => {
  it("wakes an offline host and prepares the model", async () => {
    const { providers, context } = fixture();
    const states: ConnectionState[] = [];
    const orchestrator = new ConnectionOrchestrator(providers, {
      setState: (state) => states.push(state),
      log: vi.fn(),
    });

    await orchestrator.prepare(context);

    expect(providers.wake.wake).toHaveBeenCalledOnce();
    expect(providers.connection.connect).toHaveBeenCalledOnce();
    expect(providers.runtime.start).toHaveBeenCalledOnce();
    expect(states).toEqual([
      "waking",
      "online",
      "ssh_connecting",
      "ssh_ready",
      "runtime_starting",
      "model_loading",
      "model_ready",
    ]);
  });

  it("reuses an already running runtime", async () => {
    const { providers, context } = fixture();
    providers.connection.isReachable = vi.fn(async () => true);
    providers.runtime.isRunning = vi.fn(async () => true);
    providers.model.isHealthy = vi.fn(async () => true);
    await new ConnectionOrchestrator(providers, { setState: vi.fn(), log: vi.fn() }).prepare(context);
    expect(providers.wake.wake).not.toHaveBeenCalled();
    expect(providers.runtime.start).not.toHaveBeenCalled();
  });

  it("surfaces a bounded model health failure", async () => {
    const { providers, context } = fixture();
    providers.connection.isReachable = vi.fn(async () => true);
    providers.runtime.isRunning = vi.fn(async () => true);
    providers.model.isHealthy = vi.fn(async () => false);
    const states: ConnectionState[] = [];
    await expect(new ConnectionOrchestrator(providers, { setState: (state) => states.push(state), log: vi.fn() }).prepare(context)).rejects.toMatchObject({ code: "UNKNOWN" });
    expect(states.at(-1)).toBe("error");
    expect(providers.model.isHealthy).toHaveBeenCalledTimes(3);
  });
});
