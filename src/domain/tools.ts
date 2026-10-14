export type ToolName =
  | "list_directory"
  | "read_file"
  | "search_text"
  | "file_metadata"
  | "shell"
  | "apply_patch";

export interface ToolDefinition {
  name: ToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolRequest {
  id: string;
  tool: ToolName;
  arguments: unknown;
  workspaceId: string;
}

export interface ToolError {
  code: "INVALID_ARGUMENT" | "BOUNDARY_VIOLATION" | "NOT_FOUND" | "POLICY_DENIED" | "EXECUTION_FAILED" | "TRANSPORT_ERROR";
  message: string;
}

export interface ToolExecutionMetadata {
  startedAt: string;
  finishedAt: string;
  truncated?: boolean;
  diff?: string;
  changedPaths?: string[];
}

export interface ToolResult<T = unknown> {
  tool: ToolName;
  success: boolean;
  output: T | null;
  durationMs: number;
  metadata: ToolExecutionMetadata;
  error?: ToolError;
}

export interface ShellResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  truncated?: boolean;
}

export interface ToolProvider {
  definitions(): ToolDefinition[];
  execute(request: ToolRequest, signal?: AbortSignal): Promise<ToolResult>;
}
