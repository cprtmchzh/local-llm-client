import type { ShellResult, ToolDefinition, ToolProvider, ToolRequest, ToolResult } from "../domain/tools";
import type { Workspace } from "../domain/workspace";
import type { WorkspaceRepository } from "./workspaces";

const definitions: ToolDefinition[] = [
  { name: "list_directory", description: "List entries inside the active workspace. Paths are workspace-relative; use an empty string for the root.", inputSchema: { type: "object", properties: { path: { type: "string", description: "Workspace-relative path, or empty string for root" } } } },
  { name: "read_file", description: "Read a text file or line range. Absolute paths are forbidden.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string", description: "Workspace-relative file path" }, startLine: { type: "number" }, endLine: { type: "number" } } } },
  { name: "search_text", description: "Search text without loading the whole workspace. Paths are workspace-relative.", inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, path: { type: "string", description: "Workspace-relative path, or empty string for root" } } } },
  { name: "file_metadata", description: "Read metadata for a workspace-relative path.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string", description: "Workspace-relative path" } } } },
  { name: "shell", description: "Run a command and return stdout, stderr and exit code", inputSchema: { type: "object", required: ["command"], properties: { command: { type: "string" }, timeoutMs: { type: "number" } } } },
  { name: "apply_patch", description: "Atomically apply a unified diff whose file paths stay inside the workspace", inputSchema: { type: "object", required: ["patch"], properties: { patch: { type: "string" } } } },
];

type Arguments = Record<string, unknown>;

function asArguments(value: unknown): Arguments {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Tool arguments must be an object");
  return value as Arguments;
}

export class WorkspaceToolProvider implements ToolProvider {
  constructor(
    private readonly workspace: Workspace,
    private readonly repository: WorkspaceRepository,
    private readonly shellExecutor: (command: string, timeoutMs: number) => Promise<ShellResult>,
  ) {}

  definitions(): ToolDefinition[] {
    return definitions;
  }

  async execute(request: ToolRequest, signal?: AbortSignal): Promise<ToolResult> {
    const started = performance.now();
    const startedAt = new Date().toISOString();
    try {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      if (request.workspaceId !== this.workspace.id) throw new Error("Workspace does not match the active tool provider");
      const args = asArguments(request.arguments);
      let output: unknown;
      let diff: string | undefined;
      let changedPaths: string[] | undefined;
      switch (request.tool) {
        case "list_directory": output = await this.repository.listDirectory(this.workspace, String(args.path ?? ""), Number(args.limit ?? 500)); break;
        case "read_file": output = await this.repository.readFile(this.workspace, String(args.path ?? ""), Number(args.startLine ?? 1), Number(args.endLine ?? 400)); break;
        case "search_text": output = await this.repository.searchText(this.workspace, String(args.query ?? ""), String(args.path ?? ""), Number(args.limit ?? 200)); break;
        case "file_metadata": output = await this.repository.metadata(this.workspace, String(args.path ?? "")); break;
        case "shell": output = await this.shellExecutor(String(args.command ?? ""), Number(args.timeoutMs ?? 120_000)); break;
        case "apply_patch": {
          const applied = await this.repository.applyPatch(this.workspace, String(args.patch ?? ""));
          output = applied;
          diff = applied.diff;
          changedPaths = applied.changedPaths;
          break;
        }
      }
      const finishedAt = new Date().toISOString();
      return { tool: request.tool, success: true, output, durationMs: performance.now() - started, metadata: { startedAt, finishedAt, diff, changedPaths } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = /workspace|absolute|traversal|symlink/i.test(message) ? "BOUNDARY_VIOLATION" : "EXECUTION_FAILED";
      return { tool: request.tool, success: false, output: null, durationMs: performance.now() - started, metadata: { startedAt, finishedAt: new Date().toISOString() }, error: { code, message } };
    }
  }
}

export class MockToolProvider implements ToolProvider {
  readonly requests: ToolRequest[] = [];
  constructor(private readonly responses: Partial<Record<ToolRequest["tool"], unknown>> = {}) {}
  definitions(): ToolDefinition[] { return definitions; }
  async execute(request: ToolRequest): Promise<ToolResult> {
    this.requests.push(request);
    const timestamp = new Date().toISOString();
    return { tool: request.tool, success: true, output: this.responses[request.tool] ?? { ok: true }, durationMs: 0, metadata: { startedAt: timestamp, finishedAt: timestamp } };
  }
}
