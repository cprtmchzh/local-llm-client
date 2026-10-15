import {
  AppError,
  type ChatRequest,
  type ChatStage,
  type Citation,
  type Message,
  type ModelInfo,
  type ProviderContext,
  type ReasoningMode,
  type SearchMode,
} from "../domain/types";
import type { ProviderBundle } from "./providers/contracts";

const reasoningFallbackOrder: Record<ReasoningMode, ReasoningMode[]> = {
  fast: ["normal", "deep", "deep-review"],
  normal: ["fast", "deep", "deep-review"],
  deep: ["normal", "fast", "deep-review"],
  "deep-review": ["deep", "normal", "fast"],
};

export interface ChatPipelineOptions {
  providers: ProviderBundle;
  context: ProviderContext;
  requestId: string;
  messages: Pick<Message, "role" | "content">[];
  searchMode: SearchMode;
  reasoningMode: ReasoningMode;
  signal: AbortSignal;
  onToken: (token: string) => void;
  onStage: (stage: ChatStage) => void;
  onMetadata: (metadata: ChatPipelineMetadata) => void;
}

export interface ChatPipelineMetadata {
  citations: Citation[];
  warnings: string[];
  reasoning: {
    requested: ReasoningMode;
    resolved: ReasoningMode;
    fallback?: string;
  };
}

export function needsWebSearch(query: string): boolean {
  const normalized = query.toLocaleLowerCase();
  return /https?:\/\//.test(normalized) || [
    "최신", "최근", "오늘", "현재", "뉴스", "검색", "출처", "근거", "날씨", "가격", "주가", "환율", "일정", "버전", "릴리스",
    "latest", "recent", "today", "current", "news", "search", "source", "citation", "weather", "price", "schedule", "version", "release",
  ].some((keyword) => normalized.includes(keyword));
}

export function resolveReasoningMode(model: ModelInfo, requested: ReasoningMode): ChatPipelineMetadata["reasoning"] {
  const supported = model.capabilities?.reasoningModes?.length
    ? model.capabilities.reasoningModes
    : (["fast", "normal"] satisfies ReasoningMode[]);
  if (supported.includes(requested)) return { requested, resolved: requested };
  const resolved = reasoningFallbackOrder[requested].find((mode) => supported.includes(mode)) ?? supported[0];
  return {
    requested,
    resolved,
    fallback: `${model.name}에서 ${requested} 모드를 지원하지 않아 ${resolved} 모드로 전환했습니다.`,
  };
}

export function normalizeCitations(results: Citation[], limit: number): Citation[] {
  const seen = new Set<string>();
  return results.flatMap((result) => {
    let key: string;
    try {
      const url = new URL(result.url);
      if (!['http:', 'https:'].includes(url.protocol)) return [];
      url.hash = "";
      url.searchParams.sort();
      key = url.toString().replace(/\/$/, "").toLocaleLowerCase();
    } catch {
      key = result.url.trim().toLocaleLowerCase();
    }
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [{
      ...result,
      id: seen.size,
      title: result.title.slice(0, 300),
      snippet: result.snippet.slice(0, 1_200),
    }];
  }).slice(0, Math.max(1, limit));
}

function abortError(timeout: boolean): AppError {
  return timeout
    ? new AppError("요청 시간이 초과되었습니다.", "REQUEST_TIMEOUT", "응답을 다시 시도하거나 제한 시간을 늘려보세요.")
    : new AppError("응답 생성을 취소했습니다.", "REQUEST_CANCELLED", "메시지는 다시 시도할 수 있습니다.");
}

async function runStage<T>(
  parentSignal: AbortSignal,
  timeoutMs: number,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (parentSignal.aborted) throw abortError(false);
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  parentSignal.addEventListener("abort", cancel, { once: true });
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let rejectAbort: ((reason: AppError) => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const rejectOnAbort = () => rejectAbort?.(abortError(timedOut && !parentSignal.aborted));
  controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
  try {
    return await Promise.race([task(controller.signal), abortPromise]);
  } catch (error) {
    if (controller.signal.aborted) throw abortError(timedOut && !parentSignal.aborted);
    throw error;
  } finally {
    window.clearTimeout(timer);
    parentSignal.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", rejectOnAbort);
  }
}

function reasoningInstruction(mode: ReasoningMode): string {
  switch (mode) {
    case "fast":
      return "Answer directly and concisely. Do not expose hidden chain-of-thought.";
    case "deep":
      return "Analyze carefully before answering. Return only the useful conclusion and supporting rationale, never hidden chain-of-thought.";
    case "deep-review":
      return "Use the supplied draft and critique to produce a corrected final answer. Do not mention or expose hidden chain-of-thought.";
    default:
      return "Give a clear, well-supported answer without exposing hidden chain-of-thought.";
  }
}

function sourceContext(citations: Citation[]): Pick<Message, "role" | "content">[] {
  if (!citations.length) return [];
  const sources = citations.map((citation) =>
    `[${citation.id}] ${citation.title}\nURL: ${citation.url}\nSnippet: ${citation.snippet}`,
  ).join("\n\n");
  return [{
    role: "system",
    content: `Use these web sources when relevant. Cite factual claims inline using [number]. Do not invent citations.\n\n${sources}`,
  }];
}

function requestFor(
  options: ChatPipelineOptions,
  suffix: string,
  messages: Pick<Message, "role" | "content">[],
): ChatRequest {
  return {
    requestId: `${options.requestId}:${suffix}`,
    baseUrl: options.providers.connection.apiBaseUrl(options.context),
    model: options.context.model.modelPath,
    temperature: options.context.profile.temperature,
    timeoutMs: options.context.settings.modelTimeoutMs,
    messages,
  };
}

export async function runChatPipeline(options: ChatPipelineOptions): Promise<ChatPipelineMetadata> {
  const emitToken = (token: string) => {
    if (!options.signal.aborted) options.onToken(token);
  };
  const reasoning = resolveReasoningMode(options.context.model, options.reasoningMode);
  const warnings = reasoning.fallback ? [reasoning.fallback] : [];
  let citations: Citation[] = [];
  const query = [...options.messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const shouldSearch = options.searchMode === "on" || (options.searchMode === "auto" && needsWebSearch(query));

  if (shouldSearch) {
    options.onStage("searching");
    try {
      citations = normalizeCitations(await runStage(
        options.signal,
        options.context.settings.searchTimeoutMs,
        (signal) => options.providers.search.search({
          requestId: `${options.requestId}:search`,
          query,
          maxResults: options.context.settings.searchMaxResults,
          timeoutMs: options.context.settings.searchTimeoutMs,
        }, signal),
      ), options.context.settings.searchMaxResults);
      if (!citations.length) warnings.push("검색 결과가 없어 모델 지식만으로 답변했습니다.");
    } catch (error) {
      if (error instanceof AppError && error.code === "REQUEST_CANCELLED") throw error;
      warnings.push(`웹 검색을 사용할 수 없어 모델 전용 답변으로 전환했습니다: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const metadata = { citations, warnings, reasoning };
  options.onMetadata(metadata);
  const sharedMessages = [
    ...sourceContext(citations),
    { role: "system" as const, content: reasoningInstruction(reasoning.resolved) },
    ...options.messages,
  ];

  if (reasoning.resolved === "deep-review") {
    options.onStage("drafting");
    const draft = await runStage(options.signal, options.context.settings.modelTimeoutMs, (signal) =>
      options.providers.model.completeChat(requestFor(options, "draft", [
        ...sharedMessages,
        { role: "system", content: "Create a complete draft answer. Return the draft only." },
      ]), signal),
    );
    options.onStage("critiquing");
    const critique = await runStage(options.signal, options.context.settings.modelTimeoutMs, (signal) =>
      options.providers.model.completeChat(requestFor(options, "critique", [
        ...sharedMessages,
        { role: "system", content: `Critique the draft for accuracy, completeness, safety, and citation quality. Return actionable critique only.\n\nDRAFT:\n${draft}` },
      ]), signal),
    );
    options.onStage("revising");
    await runStage(options.signal, options.context.settings.modelTimeoutMs, (signal) =>
      options.providers.model.streamChat(requestFor(options, "final", [
        ...sharedMessages,
        { role: "system", content: `Write the final revised answer only. Incorporate valid critique and preserve accurate citations.\n\nDRAFT:\n${draft}\n\nCRITIQUE:\n${critique}` },
      ]), emitToken, signal),
    );
  } else {
    options.onStage("answering");
    await runStage(options.signal, options.context.settings.modelTimeoutMs, (signal) =>
      options.providers.model.streamChat(requestFor(options, "answer", sharedMessages), emitToken, signal),
    );
  }
  return metadata;
}
