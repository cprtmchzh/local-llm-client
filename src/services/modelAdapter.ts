import type { AgentResponse } from "../domain/agent";

interface OpenAiChoice {
  message?: {
    content?: string | null;
    tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
  };
}

export function normalizeOpenAiAgentResponse(value: unknown): AgentResponse {
  if (!value || typeof value !== "object") throw new Error("Model response must be an object");
  const choices = (value as { choices?: OpenAiChoice[] }).choices;
  const message = choices?.[0]?.message;
  if (!message) throw new Error("Model response did not contain a message");
  const call = message.tool_calls?.[0];
  if (call?.function?.name) {
    let args: unknown;
    try {
      args = JSON.parse(call.function.arguments ?? "{}");
    } catch {
      throw new Error("Model tool arguments were not valid JSON");
    }
    return { type: "tool_call", id: call.id ?? crypto.randomUUID(), tool: call.function.name, arguments: args };
  }
  if (typeof message.content === "string") return { type: "final", content: message.content };
  throw new Error("Model response contained neither a tool call nor final content");
}

export function qwenToolsPrompt(toolNames: string[]): string {
  return `You are a local coding agent. Use only these tools: ${toolNames.join(", ")}. All file paths must be relative to the active workspace; never use absolute paths or '..'. Represent the workspace root with an empty path string. Return OpenAI-compatible tool_calls when a tool is required.`;
}
