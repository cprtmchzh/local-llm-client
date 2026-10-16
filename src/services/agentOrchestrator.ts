import type { AgentBudget, AgentModel, AgentResponse, AgentRun, AgentStatus, ApprovalRequest } from "../domain/agent";
import type { ToolProvider, ToolRequest, ToolResult } from "../domain/tools";
import { createId } from "../lib/utils";
import type { ToolPolicy } from "./toolPolicy";

export interface AgentHooks {
  onUpdate?: (run: AgentRun) => void;
  requestApproval?: (request: ApprovalRequest) => Promise<boolean>;
}

export const defaultAgentBudget: AgentBudget = { maxSteps: 64, maxToolCalls: 48, maxFailures: 8, maxRuntimeMs: 30 * 60_000 };

const verificationCommand = /(?:^|(?:&&|;|\|\|)\s*)(?:npm\s+(?:test|run\s+(?:test|build|lint|typecheck|check))|pnpm\s+(?:test|(?:run\s+)?(?:test|build|lint|typecheck|check))|yarn\s+(?:test|(?:run\s+)?(?:test|build|lint|typecheck|check))|bun\s+(?:test|run\s+(?:test|build|lint|typecheck|check))|cargo\s+(?:test|check|clippy)|pytest\b|python(?:3)?\s+-m\s+pytest\b|go\s+test\b|dotnet\s+test\b|git\s+diff\s+--check\b|(?:npx\s+)?tsc\b)/i;

export function isVerificationCommand(command: string): boolean {
  const normalized = command.trim();
  if (/\|\||;\s*(?:true|:|exit\s+0)\b/i.test(normalized)) return false;
  return verificationCommand.test(normalized);
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}

export class AgentOrchestrator {
  private controller: AbortController | null = null;

  constructor(
    private readonly model: AgentModel,
    private readonly tools: ToolProvider,
    private readonly policy: ToolPolicy,
    private readonly hooks: AgentHooks = {},
  ) {}

  cancel(): void {
    this.controller?.abort();
  }

  async run(task: string, workspaceId: string, budget: AgentBudget = defaultAgentBudget): Promise<AgentRun> {
    this.controller?.abort();
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const timestamp = new Date().toISOString();
    const run: AgentRun = {
      id: createId(),
      workspaceId,
      task,
      status: "planning",
      steps: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      progress: {
        cycle: 0,
        toolCalls: 0,
        successfulToolCalls: 0,
        consecutiveFailures: 0,
        verificationStatus: "not_required",
      },
    };
    const startedAt = performance.now();
    let runtimeExpired = false;
    const runtimeTimer = globalThis.setTimeout(() => {
      runtimeExpired = true;
      this.controller?.abort();
    }, budget.maxRuntimeMs);
    let toolCalls = 0;
    let consecutiveFailures = 0;
    const update = (status: AgentStatus) => {
      run.status = status;
      run.updatedAt = new Date().toISOString();
      this.hooks.onUpdate?.({ ...run, steps: [...run.steps] });
    };
    const stop = (status: AgentStatus, reason: AgentRun["stopReason"]) => {
      run.stopReason = reason;
      update(status);
      return run;
    };

    try {
      for (let index = 0; index < budget.maxSteps; index += 1) {
        if (signal.aborted) return stop("cancelled", "cancelled");
        if (performance.now() - startedAt >= budget.maxRuntimeMs) return stop("failed", "max_runtime");
        run.progress.cycle = index + 1;
        update(index === 0 ? "planning" : "processing_result");
        let response: AgentResponse | null = null;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            response = await abortable(this.model.respond({ task, steps: run.steps, tools: this.tools.definitions() }, signal), signal);
            break;
          } catch (error) {
            if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
            const message = error instanceof Error ? error.message : String(error);
            run.steps.push(this.failedStep(index, `Model request failed (${attempt}/3): ${message}`));
            update("planning");
            if (attempt === 3) throw error;
            await abortable(new Promise<void>((resolve) => globalThis.setTimeout(resolve, 500 * attempt)), signal);
          }
        }
        if (!response) throw new Error("Model did not return an agent response");
        if (signal.aborted) return stop("cancelled", "cancelled");
        if (response.type === "final") {
          if (toolCalls === 0) {
            run.steps.push(this.checkpointStep(
              index,
              "완료 판정을 보류했습니다. 먼저 Workspace를 도구로 확인하고 실제 근거를 확보하세요.",
            ));
            update("verifying");
            continue;
          }
          if (run.progress.verificationStatus === "pending" || run.progress.verificationStatus === "failed") {
            run.steps.push(this.checkpointStep(
              index,
              "완료 판정을 보류했습니다. 마지막 변경 이후 테스트, 빌드 또는 git diff --check를 실행하고 실패하면 수정 사이클을 계속하세요.",
            ));
            update("verifying");
            continue;
          }
          run.finalResponse = response.content;
          return stop("completed", "final_response");
        }
        if (toolCalls >= budget.maxToolCalls) return stop("failed", "max_tool_calls");
        const definition = this.tools.definitions().find((tool) => tool.name === response.tool);
        if (!definition) {
          consecutiveFailures += 1;
          run.progress.consecutiveFailures = consecutiveFailures;
          run.steps.push(this.failedStep(index, `Unknown tool: ${response.tool}`));
          if (consecutiveFailures >= budget.maxFailures) return stop("failed", "max_failures");
          continue;
        }
        const request: ToolRequest = { id: response.id, tool: definition.name, arguments: response.arguments, workspaceId };
        const decision = this.policy.evaluate(request);
        if (decision === "DENY") {
          consecutiveFailures += 1;
          run.progress.consecutiveFailures = consecutiveFailures;
          run.steps.push(this.resultStep(index, request, this.policyResult(request, "Tool policy denied execution")));
          if (consecutiveFailures >= budget.maxFailures) return stop("failed", "max_failures");
          continue;
        }
        if (decision === "ASK") {
          update("waiting_approval");
          const approval = this.hooks.requestApproval?.({ id: createId(), runId: run.id, toolRequest: request, status: "pending" }) ?? Promise.resolve(false);
          const approved = await abortable(approval, signal);
          if (signal.aborted) return stop("cancelled", "cancelled");
          if (!approved) {
            run.steps.push(this.resultStep(index, request, this.policyResult(request, "User rejected tool execution")));
            consecutiveFailures += 1;
            run.progress.consecutiveFailures = consecutiveFailures;
            if (consecutiveFailures >= budget.maxFailures) return stop("failed", "max_failures");
            continue;
          }
        }
        update("executing_tool");
        toolCalls += 1;
        run.progress.toolCalls = toolCalls;
        const result = await abortable(this.tools.execute(request, signal), signal);
        run.steps.push(this.resultStep(index, request, result));
        if (result.success) {
          consecutiveFailures = 0;
          run.progress.successfulToolCalls += 1;
          if (request.tool === "apply_patch") {
            run.progress.verificationStatus = "pending";
            run.progress.lastVerificationCommand = undefined;
          }
          if (request.tool === "shell") {
            const command = this.shellCommand(request);
            if (isVerificationCommand(command)) {
              run.progress.verificationStatus = "passed";
              run.progress.lastVerificationCommand = command;
            }
          }
        } else {
          consecutiveFailures += 1;
          if (request.tool === "shell" && isVerificationCommand(this.shellCommand(request))) {
            run.progress.verificationStatus = "failed";
            run.progress.lastVerificationCommand = this.shellCommand(request);
          }
        }
        run.progress.consecutiveFailures = consecutiveFailures;
        if (consecutiveFailures >= budget.maxFailures) return stop("failed", "max_failures");
      }
      return stop("failed", "max_steps");
    } catch (error) {
      if (runtimeExpired) return stop("failed", "max_runtime");
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return stop("cancelled", "cancelled");
      run.steps.push(this.failedStep(run.steps.length, error instanceof Error ? error.message : String(error)));
      return stop("failed", "error");
    } finally {
      globalThis.clearTimeout(runtimeTimer);
    }
  }

  private resultStep(index: number, request: ToolRequest, result: ToolResult) {
    return { id: createId(), index, status: "processing_result" as const, summary: `${result.success ? "도구 완료" : "도구 실패"}: ${request.tool}`, toolCall: request, toolResult: result, createdAt: new Date().toISOString() };
  }

  private failedStep(index: number, message: string) {
    return { id: createId(), index, status: "failed" as const, summary: message, createdAt: new Date().toISOString() };
  }

  private checkpointStep(index: number, message: string) {
    return { id: createId(), index, status: "verifying" as const, summary: message, createdAt: new Date().toISOString() };
  }

  private shellCommand(request: ToolRequest): string {
    if (request.tool !== "shell" || !request.arguments || typeof request.arguments !== "object") return "";
    return "command" in request.arguments ? String(request.arguments.command) : "";
  }

  private policyResult(request: ToolRequest, message: string): ToolResult {
    const timestamp = new Date().toISOString();
    return { tool: request.tool, success: false, output: null, durationMs: 0, metadata: { startedAt: timestamp, finishedAt: timestamp }, error: { code: "POLICY_DENIED", message } };
  }
}
