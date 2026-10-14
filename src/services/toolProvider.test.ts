import { describe, expect, it, vi } from "vitest";
import type { Workspace } from "../domain/workspace";
import { WorkspaceToolProvider } from "./toolProvider";
import type { WorkspaceRepository } from "./workspaces";

const workspace: Workspace = { id: "workspace", name: "project", rootPath: "/project", createdAt: "2026-01-01", lastOpenedAt: "2026-01-01" };
const repository: WorkspaceRepository = {
  validate: vi.fn(async (path) => path),
  listDirectory: vi.fn(async () => []),
  readFile: vi.fn(async (_workspace, path) => ({ path, content: "text", startLine: 1, endLine: 1, truncated: false })),
  searchText: vi.fn(async () => []),
  metadata: vi.fn(async (_workspace, path) => ({ path, size: 4, modifiedAt: "2026-01-01", isDirectory: false })),
  applyPatch: vi.fn(async (_workspace, patch) => ({ diff: patch, changedPaths: ["file.ts"] })),
  revertPatch: vi.fn(async (_workspace, patch) => ({ diff: patch, changedPaths: ["file.ts"] })),
};

describe("WorkspaceToolProvider", () => {
  it("returns a command exit 1 as structured tool output, not a transport exception", async () => {
    const provider = new WorkspaceToolProvider(workspace, repository, async (command) => ({ command, stdout: "", stderr: "tests failed", exitCode: 1, durationMs: 12, timedOut: false }));
    const result = await provider.execute({ id: "shell-1", tool: "shell", workspaceId: workspace.id, arguments: { command: "npm test" } });
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({ exitCode: 1, stderr: "tests failed" });
  });

  it("keeps diff and changed paths in patch metadata", async () => {
    const provider = new WorkspaceToolProvider(workspace, repository, vi.fn());
    const diff = "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new";
    const result = await provider.execute({ id: "patch-1", tool: "apply_patch", workspaceId: workspace.id, arguments: { patch: diff } });
    expect(result.metadata).toMatchObject({ diff, changedPaths: ["file.ts"] });
  });
});
