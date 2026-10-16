import { describe, expect, it } from "vitest";
import type { AgentStep } from "../domain/agent";
import { compactAgentSteps, normalizeOpenAiAgentResponse, qwenToolsPrompt } from "./modelAdapter";

describe("normalizeOpenAiAgentResponse", () => {
  it("normalizes a Qwen/OpenAI compatible tool call", () => {
    expect(normalizeOpenAiAgentResponse({ choices: [{ message: { tool_calls: [{ id: "call-1", function: { name: "read_file", arguments: "{\"path\":\"README.md\"}" } }] } }] })).toEqual({ type: "tool_call", id: "call-1", tool: "read_file", arguments: { path: "README.md" } });
  });
  it("normalizes final content", () => expect(normalizeOpenAiAgentResponse({ choices: [{ message: { content: "done" } }] })).toEqual({ type: "final", content: "done" }));
  it("uses reasoning content when the model omits visible content", () => expect(normalizeOpenAiAgentResponse({ choices: [{ message: { content: "", reasoning_content: "verified result" } }] })).toEqual({ type: "final", content: "verified result" }));
  it("rejects malformed tool JSON", () => expect(() => normalizeOpenAiAgentResponse({ choices: [{ message: { tool_calls: [{ function: { name: "read_file", arguments: "{" } }] } }] })).toThrow(/valid JSON/));

  it("keeps the agent ledger inside the 8K context budget", () => {
    const steps = Array.from({ length: 30 }, (_, index): AgentStep => ({
      id: String(index),
      index,
      status: "processing_result",
      summary: `step ${index}`,
      createdAt: "2026-01-01T00:00:00.000Z",
      toolResult: {
        tool: "read_file",
        success: true,
        output: "x".repeat(5_000),
        durationMs: 1,
        metadata: { startedAt: "", finishedAt: "" },
      },
    }));
    expect(JSON.stringify(compactAgentSteps(steps)).length).toBeLessThanOrEqual(20_000);
  });

  it("instructs the model to verify edits before completing", () => {
    expect(qwenToolsPrompt(["read_file", "apply_patch", "shell"])).toContain("verify -> repair");
    expect(qwenToolsPrompt(["read_file", "apply_patch", "shell"])).toContain("Return a final response only after");
  });
});
