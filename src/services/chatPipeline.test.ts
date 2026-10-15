import { describe, expect, it, vi } from "vitest";
import { defaultModels, defaultProfiles, defaultSettings } from "../domain/defaults";
import type { Citation, ProviderContext, ReasoningMode } from "../domain/types";
import { needsWebSearch, normalizeCitations, resolveReasoningMode, runChatPipeline } from "./chatPipeline";
import type { ProviderBundle } from "./providers/contracts";

function fixture(): { providers: ProviderBundle; context: ProviderContext } {
  const context = {
    settings: { ...defaultSettings, mockMode: true },
    model: defaultModels[1],
    profile: defaultProfiles[0],
  };
  const providers: ProviderBundle = {
    wake: { wake: vi.fn() },
    connection: {
      isReachable: vi.fn(async () => true), connect: vi.fn(), disconnect: vi.fn(),
      execute: vi.fn(), apiBaseUrl: vi.fn(() => "http://127.0.0.1:8080/v1"),
    },
    runtime: { isRunning: vi.fn(), start: vi.fn(), stop: vi.fn(), restart: vi.fn(), instance: vi.fn() },
    model: {
      isHealthy: vi.fn(async () => true),
      streamChat: vi.fn(async (_request, onToken) => onToken("final")),
      completeChat: vi.fn(async (request) => request.requestId.endsWith(":draft") ? "draft" : "critique"),
      completeAgent: vi.fn(async () => ({ type: "final" as const, content: "done" })),
    },
    search: { search: vi.fn(async () => [{ id: 9, title: "Example", url: "https://example.com/", snippet: "source" }]) },
  };
  return { providers, context };
}

describe("chat pipeline", () => {
  it("routes automatic search with a deterministic heuristic", () => {
    expect(needsWebSearch("오늘 환율을 출처와 함께 알려줘")).toBe(true);
    expect(needsWebSearch("재귀 함수를 설명해줘")).toBe(false);
  });

  it("deduplicates and renumbers citations", () => {
    const results: Citation[] = [
      { id: 4, title: "One", url: "https://example.com/a", snippet: "a" },
      { id: 8, title: "Duplicate", url: "https://example.com/a#section", snippet: "b" },
    ];
    expect(normalizeCitations(results, 5)).toEqual([{ id: 1, title: "One", url: "https://example.com/a", snippet: "a" }]);
  });

  it("falls back to a supported reasoning mode", () => {
    const model = { ...defaultModels[0], capabilities: { reasoningModes: ["normal"] as ReasoningMode[] } };
    expect(resolveReasoningMode(model, "deep-review")).toMatchObject({ requested: "deep-review", resolved: "normal" });
    expect(resolveReasoningMode(defaultModels[0], "deep-review")).toMatchObject({ resolved: "deep" });
  });

  it("runs draft, critique, and final revision without exposing intermediate text", async () => {
    const { providers, context } = fixture();
    const tokens: string[] = [];
    const stages: string[] = [];
    await runChatPipeline({
      providers, context, requestId: "request", messages: [{ role: "user", content: "최신 자료" }],
      searchMode: "auto", reasoningMode: "deep-review", signal: new AbortController().signal,
      onToken: (token) => tokens.push(token), onStage: (stage) => stages.push(stage), onMetadata: vi.fn(),
    });
    expect(providers.search.search).toHaveBeenCalledOnce();
    expect(providers.model.completeChat).toHaveBeenCalledTimes(2);
    expect(providers.model.streamChat).toHaveBeenCalledOnce();
    for (const [request] of vi.mocked(providers.model.completeChat).mock.calls) {
      expect(request.messages[0].role).toBe("system");
      expect(request.messages.filter((message) => message.role === "system")).toHaveLength(1);
    }
    for (const [request] of vi.mocked(providers.model.streamChat).mock.calls) {
      expect(request.messages[0].role).toBe("system");
      expect(request.messages.filter((message) => message.role === "system")).toHaveLength(1);
    }
    expect(stages).toEqual(["searching", "drafting", "critiquing", "revising"]);
    expect(tokens).toEqual(["final"]);
  });

  it("falls back to model-only answering when search fails", async () => {
    const { providers, context } = fixture();
    providers.search.search = vi.fn(async () => { throw new Error("offline"); });
    let warnings: string[] = [];
    await runChatPipeline({
      providers, context, requestId: "request", messages: [{ role: "user", content: "latest news" }],
      searchMode: "auto", reasoningMode: "normal", signal: new AbortController().signal,
      onToken: vi.fn(), onStage: vi.fn(), onMetadata: (metadata) => { warnings = metadata.warnings; },
    });
    expect(warnings[0]).toContain("모델 전용 답변");
    expect(providers.model.streamChat).toHaveBeenCalledOnce();
  });

  it("shows an actionable message when the Tavily credential is missing", async () => {
    const { providers, context } = fixture();
    providers.search.search = vi.fn(async () => {
      throw new Error("credential error: Tavily API key is not configured");
    });
    let warnings: string[] = [];
    await runChatPipeline({
      providers, context, requestId: "request", messages: [{ role: "user", content: "최신 보안 뉴스" }],
      searchMode: "on", reasoningMode: "normal", signal: new AbortController().signal,
      onToken: vi.fn(), onStage: vi.fn(), onMetadata: (metadata) => { warnings = metadata.warnings; },
    });

    expect(warnings).toEqual([
      "Tavily API 키가 설정되지 않아 모델 전용 답변으로 전환했습니다. 설정 → 웹 검색에서 API 키를 등록하세요.",
    ]);
  });

  it("times out a stalled search and continues with a visible fallback", async () => {
    const { providers, context } = fixture();
    context.settings.searchTimeoutMs = 5;
    providers.search.search = vi.fn(() => new Promise<Citation[]>(() => undefined));
    let warnings: string[] = [];
    await runChatPipeline({
      providers, context, requestId: "request", messages: [{ role: "user", content: "latest news" }],
      searchMode: "on", reasoningMode: "normal", signal: new AbortController().signal,
      onToken: vi.fn(), onStage: vi.fn(), onMetadata: (metadata) => { warnings = metadata.warnings; },
    });
    expect(warnings[0]).toContain("시간이 초과");
    expect(providers.model.streamChat).toHaveBeenCalledOnce();
  });

  it("keeps model generation running without a wall-clock timeout", async () => {
    vi.useFakeTimers();
    try {
      const { providers, context } = fixture();
      context.settings.modelTimeoutMs = 0;
      providers.model.streamChat = vi.fn((_request, onToken) => new Promise<void>((resolve) => {
        window.setTimeout(() => {
          onToken("late answer");
          resolve();
        }, 1_000_000);
      }));
      const tokens: string[] = [];
      const result = runChatPipeline({
        providers, context, requestId: "request", messages: [{ role: "user", content: "long task" }],
        searchMode: "off", reasoningMode: "normal", signal: new AbortController().signal,
        onToken: (token) => tokens.push(token), onStage: vi.fn(), onMetadata: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(1_000_000);
      await expect(result).resolves.toBeDefined();
      expect(tokens).toEqual(["late answer"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops before model work when cancelled", async () => {
    const { providers, context } = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(runChatPipeline({
      providers, context, requestId: "request", messages: [{ role: "user", content: "latest news" }],
      searchMode: "on", reasoningMode: "deep-review", signal: controller.signal,
      onToken: vi.fn(), onStage: vi.fn(), onMetadata: vi.fn(),
    })).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(providers.model.completeChat).not.toHaveBeenCalled();
  });
});
