import type { ToolRequest } from "../domain/tools";

export type ToolPolicyDecision = "AUTO" | "ASK" | "DENY";

export interface ToolPolicy {
  evaluate(request: ToolRequest): ToolPolicyDecision;
}

const destructiveShell = /(?:^|\s)(?:git\s+push|rm\s|del\s|remove-item|shutdown|restart-computer)(?:\s|$)/i;
const deniedShell = /(?:^|\s)(?:shutdown|restart-computer)(?:\s|$)/i;

export class DefaultToolPolicy implements ToolPolicy {
  constructor(private readonly autoApplyPatch = false) {}

  evaluate(request: ToolRequest): ToolPolicyDecision {
    if (["list_directory", "read_file", "search_text", "file_metadata"].includes(request.tool)) return "AUTO";
    if (request.tool === "apply_patch") return this.autoApplyPatch ? "AUTO" : "ASK";
    if (request.tool === "shell") {
      const command = typeof request.arguments === "object" && request.arguments && "command" in request.arguments
        ? String(request.arguments.command)
        : "";
      if (deniedShell.test(command)) return "DENY";
      if (destructiveShell.test(command)) return "ASK";
      return "AUTO";
    }
    return "DENY";
  }
}
