import { describe, expect, it, vi } from "vitest";
import type { AgentModel, AgentResponse } from "../domain/agent";
import { MockToolProvider } from "./toolProvider";
import { AgentOrchestrator, isVerificationCommand } from "./agentOrchestrator";
import { DefaultToolPolicy } from "./toolPolicy";

class SequenceModel implements AgentModel {
  constructor(private readonly responses: AgentResponse[]) {}
  async respond(): Promise<AgentResponse> {
    const response = this.responses.shift();
    if (!response) throw new Error("No response");
    return response;
  }
}

describe("AgentOrchestrator", () => {
  it("does not accept verification commands that mask failures", () => {
    expect(isVerificationCommand("npm test")).toBe(true);
    expect(isVerificationCommand("npm test || true")).toBe(false);
    expect(isVerificationCommand("cargo test; exit 0")).toBe(false);
  });

  it("runs a deterministic tool loop to a final response", async () => {
    const tools = new MockToolProvider({ read_file: { content: "hello" } });
    const model = new SequenceModel([
      { type: "tool_call", id: "call-1", tool: "read_file", arguments: { path: "README.md" } },
      { type: "final", content: "Finished" },
    ]);
    const run = await new AgentOrchestrator(model, tools, new DefaultToolPolicy()).run("Inspect", "workspace");
    expect(run.status).toBe("completed");
    expect(run.stopReason).toBe("final_response");
    expect(run.steps).toHaveLength(1);
    expect(tools.requests).toHaveLength(1);
  });

  it("continues cycling until edits are verified", async () => {
    const tools = new MockToolProvider();
    const model = new SequenceModel([
      { type: "tool_call", id: "inspect", tool: "read_file", arguments: { path: "src/app.ts" } },
      { type: "tool_call", id: "patch", tool: "apply_patch", arguments: { patch: "diff" } },
      { type: "final", content: "premature" },
      { type: "tool_call", id: "verify", tool: "shell", arguments: { command: "npm test" } },
      { type: "final", content: "verified" },
    ]);
    const run = await new AgentOrchestrator(model, tools, new DefaultToolPolicy(true)).run("Fix", "workspace");

    expect(run.status).toBe("completed");
    expect(run.finalResponse).toBe("verified");
    expect(run.progress.verificationStatus).toBe("passed");
    expect(run.steps.some((step) => step.status === "verifying")).toBe(true);
    expect(tools.requests.map((request) => request.tool)).toEqual(["read_file", "apply_patch", "shell"]);
  });

  it("requires workspace evidence before accepting a final response", async () => {
    const tools = new MockToolProvider();
    const model = new SequenceModel([
      { type: "final", content: "guessed" },
      { type: "tool_call", id: "inspect", tool: "list_directory", arguments: { path: "" } },
      { type: "final", content: "grounded" },
    ]);
    const run = await new AgentOrchestrator(model, tools, new DefaultToolPolicy()).run("Inspect", "workspace");

    expect(run.status).toBe("completed");
    expect(run.finalResponse).toBe("grounded");
    expect(run.steps[0]?.status).toBe("verifying");
  });

  it("does not execute an ASK tool before approval", async () => {
    const tools = new MockToolProvider();
    const model = new SequenceModel([{ type: "tool_call", id: "patch", tool: "apply_patch", arguments: { patch: "diff" } }, { type: "final", content: "done" }]);
    const requestApproval = vi.fn(async () => false);
    await new AgentOrchestrator(model, tools, new DefaultToolPolicy(), { requestApproval }).run("Edit", "workspace");
    expect(requestApproval).toHaveBeenCalledOnce();
    expect(tools.requests).toHaveLength(0);
  });

  it("stops at tool-call budget", async () => {
    const tools = new MockToolProvider();
    const model: AgentModel = { respond: vi.fn(async (): Promise<AgentResponse> => ({ type: "tool_call", id: crypto.randomUUID(), tool: "read_file", arguments: { path: "x" } })) };
    const run = await new AgentOrchestrator(model, tools, new DefaultToolPolicy()).run("Loop", "workspace", { maxSteps: 5, maxToolCalls: 1, maxFailures: 3, maxRuntimeMs: 10_000 });
    expect(run.status).toBe("failed");
    expect(run.stopReason).toBe("max_tool_calls");
    expect(tools.requests).toHaveLength(1);
  });

  it("cancels without starting another tool", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const model: AgentModel = { respond: vi.fn(async (_input, signal): Promise<AgentResponse> => { await pending; if (signal?.aborted) throw new DOMException("Cancelled", "AbortError"); return { type: "final", content: "late" }; }) };
    const tools = new MockToolProvider();
    const orchestrator = new AgentOrchestrator(model, tools, new DefaultToolPolicy());
    const promise = orchestrator.run("Wait", "workspace");
    orchestrator.cancel();
    release();
    const run = await promise;
    expect(run.status).toBe("cancelled");
    expect(tools.requests).toHaveLength(0);
  });

  it("enforces max runtime while the model is pending", async () => {
    const model: AgentModel = { respond: vi.fn(() => new Promise<AgentResponse>(() => undefined)) };
    const run = await new AgentOrchestrator(model, new MockToolProvider(), new DefaultToolPolicy()).run("Wait", "workspace", { maxSteps: 5, maxToolCalls: 3, maxFailures: 2, maxRuntimeMs: 10 });
    expect(run.status).toBe("failed");
    expect(run.stopReason).toBe("max_runtime");
  });
});
