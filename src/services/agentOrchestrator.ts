import type { AgentBudget, AgentModel, AgentRun, AgentStatus, ApprovalRequest } from "../domain/agent";
import type { ToolProvider, ToolRequest, ToolResult } from "../domain/tools";
import { createId } from "../lib/utils";
import type { ToolPolicy } from "./toolPolicy";

export interface AgentHooks {
  onUpdate?: (run: AgentRun) => void;
  requestApproval?: (request: ApprovalRequest) => Promise<boolean>;
}

export const defaultAgentBudget: AgentBudget = { maxSteps: 24, maxToolCalls: 16, maxFailures: 3, maxRuntimeMs: 10 * 60_000 };

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
    const run: AgentRun = { id: createId(), workspaceId, task, status: "planning", steps: [], createdAt: timestamp, updatedAt: timestamp };
    const startedAt = performance.now();
    let runtimeExpired = false;
    const runtimeTimer = globalThis.setTimeout(() => {
      runtimeExpired = true;
      this.controller?.abort();
    }, budget.maxRuntimeMs);
    let toolCalls = 0;
    let failures = 0;
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
        update(index === 0 ? "planning" : "processing_result");
        const response = await abortable(this.model.respond({ task, steps: run.steps, tools: this.tools.definitions() }, signal), signal);
        if (signal.aborted) return stop("cancelled", "cancelled");
        if (response.type === "final") {
          run.finalResponse = response.content;
          return stop("completed", "final_response");
        }
        if (toolCalls >= budget.maxToolCalls) return stop("failed", "max_tool_calls");
        const definition = this.tools.definitions().find((tool) => tool.name === response.tool);
        if (!definition) {
          failures += 1;
          run.steps.push(this.failedStep(index, `Unknown tool: ${response.tool}`));
          if (failures >= budget.maxFailures) return stop("failed", "max_failures");
          continue;
        }
        const request: ToolRequest = { id: response.id, tool: definition.name, arguments: response.arguments, workspaceId };
        const decision = this.policy.evaluate(request);
        if (decision === "DENY") {
          failures += 1;
          run.steps.push(this.resultStep(index, request, this.policyResult(request, "Tool policy denied execution")));
          if (failures >= budget.maxFailures) return stop("failed", "max_failures");
          continue;
        }
        if (decision === "ASK") {
          update("waiting_approval");
          const approval = this.hooks.requestApproval?.({ id: createId(), runId: run.id, toolRequest: request, status: "pending" }) ?? Promise.resolve(false);
          const approved = await abortable(approval, signal);
          if (signal.aborted) return stop("cancelled", "cancelled");
          if (!approved) {
            run.steps.push(this.resultStep(index, request, this.policyResult(request, "User rejected tool execution")));
            failures += 1;
            continue;
          }
        }
        update("executing_tool");
        toolCalls += 1;
        const result = await abortable(this.tools.execute(request, signal), signal);
        run.steps.push(this.resultStep(index, request, result));
        if (!result.success) failures += 1;
        if (failures >= budget.maxFailures) return stop("failed", "max_failures");
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
    return { id: createId(), index, status: "processing_result" as const, summary: `${result.success ? "Completed" : "Failed"} ${request.tool}`, toolCall: request, toolResult: result, createdAt: new Date().toISOString() };
  }

  private failedStep(index: number, message: string) {
    return { id: createId(), index, status: "failed" as const, summary: message, createdAt: new Date().toISOString() };
  }

  private policyResult(request: ToolRequest, message: string): ToolResult {
    const timestamp = new Date().toISOString();
    return { tool: request.tool, success: false, output: null, durationMs: 0, metadata: { startedAt: timestamp, finishedAt: timestamp }, error: { code: "POLICY_DENIED", message } };
  }
}
