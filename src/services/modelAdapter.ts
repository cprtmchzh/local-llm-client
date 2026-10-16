import type { AgentResponse, AgentStep } from "../domain/agent";

interface OpenAiChoice {
  message?: {
    content?: string | null;
    reasoning?: string | null;
    reasoning_content?: string | null;
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
  const finalContent = [message.content, message.reasoning_content, message.reasoning]
    .find((content) => typeof content === "string" && content.trim());
  if (typeof finalContent === "string") return { type: "final", content: finalContent };
  throw new Error("Model response contained neither a tool call nor final content");
}

export function qwenToolsPrompt(toolNames: string[]): string {
  return `You are an autonomous local coding agent responsible for completing one objective end to end.

Available tools: ${toolNames.join(", ")}.

Operating contract:
1. Continue the inspect -> plan -> act -> verify -> repair cycle until the objective is genuinely complete or external input is strictly required.
2. Inspect the workspace with tools before making claims. Use apply_patch for file edits. Do not edit files through shell commands.
3. After every edit, run the most relevant tests, build, lint, typecheck, or at minimum git diff --check. If verification fails, inspect the output, repair the issue, and verify again.
4. Return a final response only after the requested outcome exists and the latest changes have passed verification. Include concise evidence in that final response.
5. All file paths must be relative to the active workspace. Never use absolute paths or '..'. Represent the workspace root with an empty path string.
6. Use exactly one OpenAI-compatible tool_call when another action is needed. Do not merely describe the action.`;
}

function compactValue(value: unknown, maxLength: number): unknown {
  if (value === null || value === undefined) return value;
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (serialized.length <= maxLength) return value;
  return `${serialized.slice(0, maxLength)}…[truncated]`;
}

export function compactAgentSteps(steps: AgentStep[], maxCharacters = 20_000): unknown[] {
  const recent = steps.slice(-10).map((step) => ({
    index: step.index,
    status: step.status,
    summary: step.summary,
    toolCall: step.toolCall ? {
      tool: step.toolCall.tool,
      arguments: compactValue(step.toolCall.arguments, 1_500),
    } : undefined,
    toolResult: step.toolResult ? {
      success: step.toolResult.success,
      output: compactValue(step.toolResult.output, 2_000),
      error: step.toolResult.error,
      changedPaths: step.toolResult.metadata.changedPaths,
    } : undefined,
  }));
  const older = steps.slice(0, -10);
  const history = older.length > 0
    ? [{
        history: older
          .map((step) => `#${step.index + 1} ${step.summary}${step.toolResult ? ` (${step.toolResult.success ? "ok" : "failed"})` : ""}`)
          .join("\n")
          .slice(-4_000),
      }]
    : [];
  const compacted = [...history, ...recent];
  while (compacted.length > 1 && JSON.stringify(compacted).length > maxCharacters) {
    compacted.splice(history.length > 0 ? 1 : 0, 1);
  }
  return compacted;
}
