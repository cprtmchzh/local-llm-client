export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  lastOpenedAt: string;
}

export interface FileMetadata {
  path: string;
  size: number;
  modifiedAt: string;
  isDirectory: boolean;
}

export interface WorkspaceFile {
  path: string;
  content: string;
  startLine: number;
  endLine: number;
  truncated: boolean;
}

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

export function assertRelativeWorkspacePath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) {
    throw new Error("Absolute paths are outside the workspace boundary");
  }
  const segments = normalized.split("/").filter((segment) => segment && segment !== ".");
  if (segments.includes("..")) throw new Error("Path traversal is outside the workspace boundary");
  return segments.join("/");
}
