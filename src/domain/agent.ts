import type { ToolDefinition, ToolRequest, ToolResult } from "./tools";

export type AgentStatus =
  | "idle"
  | "planning"
  | "executing_tool"
  | "waiting_tool"
  | "waiting_approval"
  | "processing_result"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentStopReason = "final_response" | "max_steps" | "max_tool_calls" | "max_failures" | "max_runtime" | "cancelled" | "error";

export interface AgentBudget {
  maxSteps: number;
  maxToolCalls: number;
  maxFailures: number;
  maxRuntimeMs: number;
}

export type AgentResponse =
  | { type: "tool_call"; id: string; tool: string; arguments: unknown }
  | { type: "final"; content: string };

export interface AgentStep {
  id: string;
  index: number;
  status: AgentStatus;
  summary: string;
  toolCall?: ToolRequest;
  toolResult?: ToolResult;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  workspaceId: string;
  task: string;
  status: AgentStatus;
  steps: AgentStep[];
  createdAt: string;
  updatedAt: string;
  finalResponse?: string;
  stopReason?: AgentStopReason;
}

export interface ApprovalRequest {
  id: string;
  runId: string;
  toolRequest: ToolRequest;
  status: "pending" | "approved" | "rejected";
}

export interface AgentModel {
  respond(input: { task: string; steps: AgentStep[]; tools: ToolDefinition[] }, signal?: AbortSignal): Promise<AgentResponse>;
}
