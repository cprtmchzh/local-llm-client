import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentModel, AgentRun, ApprovalRequest } from "../domain/agent";
import type { ShellResult } from "../domain/tools";
import type { AppSettings, ProviderContext } from "../domain/types";
import type { FileMetadata, Workspace } from "../domain/workspace";
import { AgentOrchestrator } from "../services/agentOrchestrator";
import { getProviders } from "../services/providers";
import { DefaultToolPolicy } from "../services/toolPolicy";
import { WorkspaceToolProvider } from "../services/toolProvider";
import { MockWorkspaceRepository, TauriWorkspaceRepository, WorkspaceService, type WorkspaceRepository } from "../services/workspaces";

export function useAgentController(
  context: ProviderContext | null,
  settings: AppSettings,
  ensureReady: () => Promise<void>,
) {
  const repository = useMemo<WorkspaceRepository>(() => settings.mockMode ? new MockWorkspaceRepository() : new TauriWorkspaceRepository(), [settings.mockMode]);
  const workspaceService = useMemo(() => new WorkspaceService(repository), [repository]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => workspaceService.list());
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(() => workspaceService.list()[0] ?? null);
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [diffDecisions, setDiffDecisions] = useState<Record<string, "accepted" | "reverted">>({});
  const orchestratorRef = useRef<AgentOrchestrator | null>(null);
  const approvalResolverRef = useRef<((approved: boolean) => void) | null>(null);
  const generationRef = useRef(0);

  const loadFiles = useCallback(async (workspace: Workspace) => {
    setFiles(await repository.listDirectory(workspace, ""));
  }, [repository]);

  const openWorkspace = useCallback(async (rootPath: string) => {
    setError(null);
    try {
      const workspace = await workspaceService.open(rootPath);
      setWorkspaces(workspaceService.list());
      setActiveWorkspace(workspace);
      await loadFiles(workspace);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [loadFiles, workspaceService]);

  const selectWorkspace = useCallback(async (workspace: Workspace) => {
    setError(null);
    try {
      const validated = await workspaceService.open(workspace.rootPath);
      setWorkspaces(workspaceService.list());
      setActiveWorkspace(validated);
      await loadFiles(validated);
      return true;
    } catch (caught) {
      workspaceService.remove(workspace.id);
      setWorkspaces(workspaceService.list());
      setActiveWorkspace((current) => current?.id === workspace.id ? null : current);
      setFiles([]);
      setError(caught instanceof Error ? caught.message : String(caught));
      return false;
    }
  }, [loadFiles, workspaceService]);

  const browseWorkspace = useCallback(async () => {
    setError(null);
    try {
      if (settings.mockMode) {
        await openWorkspace("/mock/workspace");
        return;
      }
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: activeWorkspace?.rootPath,
        title: "Agent 작업 폴더 선택",
      });
      if (typeof selected === "string") await openWorkspace(selected);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [activeWorkspace?.rootPath, openWorkspace, settings.mockMode]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const recentWorkspace of workspaceService.list()) {
        if (cancelled) return;
        if (await selectWorkspace(recentWorkspace)) return;
      }
      if (!cancelled) setError(null);
    })();
    return () => { cancelled = true; };
  }, [selectWorkspace, workspaceService]);

  const start = useCallback(async (task: string) => {
    if (!context || !activeWorkspace || !task.trim()) return;
    setError(null);
    setRun(null);
    setDiffDecisions({});
    setIsStarting(true);
    const generation = ++generationRef.current;
    try {
      await ensureReady();
      if (generation !== generationRef.current) return;
      const providers = getProviders(settings);
      const model: AgentModel = { respond: ({ task: currentTask, steps, tools }, signal) => providers.model.completeAgent(context, currentTask, steps, tools, signal) };
      const shellExecutor = settings.mockMode
        ? async (command: string): Promise<ShellResult> => ({ command, stdout: "Mock command completed", stderr: "", exitCode: 0, durationMs: 0, timedOut: false })
        : (command: string, timeoutMs: number) => invoke<ShellResult>("execute_workspace_shell", { rootPath: activeWorkspace.rootPath, command, timeoutMs });
      const toolProvider = new WorkspaceToolProvider(activeWorkspace, repository, shellExecutor);
      const orchestrator = new AgentOrchestrator(model, toolProvider, new DefaultToolPolicy(true), {
        onUpdate: setRun,
        requestApproval: (request) => new Promise<boolean>((resolve) => {
          approvalResolverRef.current = resolve;
          setApproval(request);
        }),
      });
      orchestratorRef.current = orchestrator;
      const completed = await orchestrator.run(task.trim(), activeWorkspace.id);
      if (generation !== generationRef.current) return;
      setRun(completed);
      await loadFiles(activeWorkspace);
    } catch (caught) {
      if (generation === generationRef.current) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (generation === generationRef.current) setIsStarting(false);
    }
  }, [activeWorkspace, context, ensureReady, loadFiles, repository, settings]);

  const resolveApproval = useCallback((approved: boolean) => {
    approvalResolverRef.current?.(approved);
    approvalResolverRef.current = null;
    setApproval(null);
  }, []);

  const stop = useCallback(() => {
    generationRef.current += 1;
    setIsStarting(false);
    approvalResolverRef.current?.(false);
    approvalResolverRef.current = null;
    setApproval(null);
    orchestratorRef.current?.cancel();
  }, []);

  const acceptDiff = useCallback((stepId: string) => {
    setDiffDecisions((current) => ({ ...current, [stepId]: "accepted" }));
  }, []);

  const revertDiff = useCallback(async (stepId: string, diff: string) => {
    if (!activeWorkspace) return;
    setError(null);
    try {
      await repository.revertPatch(activeWorkspace, diff);
      setDiffDecisions((current) => ({ ...current, [stepId]: "reverted" }));
      await loadFiles(activeWorkspace);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [activeWorkspace, loadFiles, repository]);

  return { workspaces, activeWorkspace, files, run, approval, error, isStarting, diffDecisions, openWorkspace, browseWorkspace, selectWorkspace, start, stop, resolveApproval, acceptDiff, revertDiff };
}
