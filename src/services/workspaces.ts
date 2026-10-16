import { invoke } from "@tauri-apps/api/core";
import type { FileMetadata, SearchMatch, Workspace, WorkspaceFile } from "../domain/workspace";
import { assertRelativeWorkspacePath } from "../domain/workspace";
import { createId, isTauri } from "../lib/utils";
import { appStorage } from "./storage";

export interface WorkspaceRepository {
  validate(rootPath: string): Promise<string>;
  listDirectory(workspace: Workspace, path: string, limit?: number): Promise<FileMetadata[]>;
  readFile(workspace: Workspace, path: string, startLine?: number, endLine?: number): Promise<WorkspaceFile>;
  searchText(workspace: Workspace, query: string, path?: string, limit?: number): Promise<SearchMatch[]>;
  metadata(workspace: Workspace, path: string): Promise<FileMetadata>;
  applyPatch(workspace: Workspace, patch: string): Promise<{ diff: string; changedPaths: string[] }>;
  revertPatch(workspace: Workspace, patch: string): Promise<{ diff: string; changedPaths: string[] }>;
}

export class TauriWorkspaceRepository implements WorkspaceRepository {
  validate(rootPath: string): Promise<string> {
    return invoke("validate_workspace", { rootPath });
  }

  listDirectory(workspace: Workspace, path: string, limit = 500): Promise<FileMetadata[]> {
    return invoke("list_workspace_directory", { rootPath: workspace.rootPath, path: assertRelativeWorkspacePath(path), limit });
  }

  readFile(workspace: Workspace, path: string, startLine = 1, endLine = 400): Promise<WorkspaceFile> {
    return invoke("read_workspace_file", { rootPath: workspace.rootPath, path: assertRelativeWorkspacePath(path), startLine, endLine });
  }

  searchText(workspace: Workspace, query: string, path = "", limit = 200): Promise<SearchMatch[]> {
    return invoke("search_workspace_text", { rootPath: workspace.rootPath, path: assertRelativeWorkspacePath(path), query, limit });
  }

  metadata(workspace: Workspace, path: string): Promise<FileMetadata> {
    return invoke("workspace_file_metadata", { rootPath: workspace.rootPath, path: assertRelativeWorkspacePath(path) });
  }

  applyPatch(workspace: Workspace, patch: string): Promise<{ diff: string; changedPaths: string[] }> {
    return invoke("apply_workspace_patch", { rootPath: workspace.rootPath, patch });
  }
  revertPatch(workspace: Workspace, patch: string): Promise<{ diff: string; changedPaths: string[] }> {
    return invoke("revert_workspace_patch", { rootPath: workspace.rootPath, patch });
  }
}

export class WorkspaceService {
  private workspaces = appStorage.loadWorkspaces();

  constructor(private readonly repository: WorkspaceRepository) {}

  list(): Workspace[] {
    return [...this.workspaces].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
  }

  async open(rootPath: string): Promise<Workspace> {
    const canonical = await this.repository.validate(rootPath);
    const timestamp = new Date().toISOString();
    const existing = this.workspaces.find((item) => item.rootPath === canonical);
    const workspace: Workspace = existing
      ? { ...existing, lastOpenedAt: timestamp }
      : {
          id: createId(),
          name: canonical.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? canonical,
          rootPath: canonical,
          createdAt: timestamp,
          lastOpenedAt: timestamp,
        };
    this.workspaces = [workspace, ...this.workspaces.filter((item) => item.id !== workspace.id)];
    appStorage.saveWorkspaces(this.workspaces);
    return workspace;
  }

  remove(workspaceId: string): void {
    this.workspaces = this.workspaces.filter((workspace) => workspace.id !== workspaceId);
    appStorage.saveWorkspaces(this.workspaces);
  }
}

export class MockWorkspaceRepository implements WorkspaceRepository {
  private readonly files = new Map<string, string>([
    ["README.md", "# Mock workspace\n\nUse the desktop app to inspect real files."],
    ["package.json", '{"scripts":{"test":"vitest run"}}'],
  ]);

  async validate(rootPath: string): Promise<string> {
    return rootPath.trim() || "/mock/workspace";
  }
  async listDirectory(_workspace: Workspace, path: string): Promise<FileMetadata[]> {
    const prefix = path ? `${assertRelativeWorkspacePath(path)}/` : "";
    return [...this.files.entries()].filter(([file]) => file.startsWith(prefix)).map(([file, content]) => ({ path: file, size: content.length, modifiedAt: new Date(0).toISOString(), isDirectory: false }));
  }
  async readFile(_workspace: Workspace, path: string, startLine = 1, endLine = 400): Promise<WorkspaceFile> {
    const safe = assertRelativeWorkspacePath(path);
    const content = this.files.get(safe);
    if (content === undefined) throw new Error("File not found");
    const lines = content.split("\n");
    return { path: safe, content: lines.slice(startLine - 1, endLine).join("\n"), startLine, endLine: Math.min(endLine, lines.length), truncated: endLine < lines.length };
  }
  async searchText(_workspace: Workspace, query: string): Promise<SearchMatch[]> {
    return [...this.files.entries()].flatMap(([path, content]) => content.split("\n").map((text, index) => ({ path, line: index + 1, text })).filter((match) => match.text.includes(query)));
  }
  async metadata(workspace: Workspace, path: string): Promise<FileMetadata> {
    const file = await this.readFile(workspace, path);
    return { path: file.path, size: file.content.length, modifiedAt: new Date(0).toISOString(), isDirectory: false };
  }
  async applyPatch(_workspace: Workspace, patch: string): Promise<{ diff: string; changedPaths: string[] }> {
    return { diff: patch, changedPaths: [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]) };
  }
  async revertPatch(_workspace: Workspace, patch: string): Promise<{ diff: string; changedPaths: string[] }> {
    return { diff: patch, changedPaths: [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]) };
  }
}

export function createWorkspaceRepository(): WorkspaceRepository {
  if (!isTauri()) throw new Error("Workspace filesystem access requires the desktop app");
  return new TauriWorkspaceRepository();
}
