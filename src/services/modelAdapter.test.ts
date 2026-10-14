import { describe, expect, it } from "vitest";
import { normalizeOpenAiAgentResponse } from "./modelAdapter";

describe("normalizeOpenAiAgentResponse", () => {
  it("normalizes a Qwen/OpenAI compatible tool call", () => {
    expect(normalizeOpenAiAgentResponse({ choices: [{ message: { tool_calls: [{ id: "call-1", function: { name: "read_file", arguments: "{\"path\":\"README.md\"}" } }] } }] })).toEqual({ type: "tool_call", id: "call-1", tool: "read_file", arguments: { path: "README.md" } });
  });
  it("normalizes final content", () => expect(normalizeOpenAiAgentResponse({ choices: [{ message: { content: "done" } }] })).toEqual({ type: "final", content: "done" }));
  it("rejects malformed tool JSON", () => expect(() => normalizeOpenAiAgentResponse({ choices: [{ message: { tool_calls: [{ function: { name: "read_file", arguments: "{" } }] } }] })).toThrow(/valid JSON/));
});
