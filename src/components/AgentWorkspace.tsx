import {
  Check,
  File,
  Folder,
  FolderOpen,
  History,
  LoaderCircle,
  Play,
  RotateCcw,
  Square,
  X,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import type { AgentRun, AgentStatus, ApprovalRequest } from "../domain/agent";
import type { FileMetadata, Workspace } from "../domain/workspace";

interface AgentWorkspaceProps {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  files: FileMetadata[];
  run: AgentRun | null;
  approval: ApprovalRequest | null;
  error: string | null;
  isStarting: boolean;
  diffDecisions: Record<string, "accepted" | "reverted">;
  onOpen: (path: string) => void;
  onSelect: (workspace: Workspace) => void;
  onStart: (task: string) => void;
  onStop: () => void;
  onApprove: (approved: boolean) => void;
  onAcceptDiff: (stepId: string) => void;
  onRevertDiff: (stepId: string, diff: string) => void;
}

const completedStatuses: AgentStatus[] = ["completed", "failed", "cancelled"];

const statusLabels: Record<AgentStatus, string> = {
  idle: "대기 중",
  planning: "계획 중",
  executing_tool: "도구 실행 중",
  waiting_tool: "결과 대기 중",
  waiting_approval: "승인 대기 중",
  processing_result: "결과 정리 중",
  completed: "완료",
  failed: "실패",
  cancelled: "취소됨",
};

export function AgentWorkspace({
  workspaces,
  activeWorkspace,
  files,
  run,
  approval,
  error,
  isStarting,
  diffDecisions,
  onOpen,
  onSelect,
  onStart,
  onStop,
  onApprove,
  onAcceptDiff,
  onRevertDiff,
}: AgentWorkspaceProps) {
  const [path, setPath] = useState("");
  const [task, setTask] = useState("");
  const busy = isStarting || Boolean(run && !completedStatuses.includes(run.status));
  const diffs = run?.steps.flatMap((step) =>
    step.toolResult?.metadata.diff ? [{ id: step.id, diff: step.toolResult.metadata.diff }] : [],
  ) ?? [];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmedTask = task.trim();
    if (trimmedTask) onStart(trimmedTask);
  };

  return (
    <main className="agent-shell">
      <aside className="agent-navigator" aria-label="Agent 탐색기">
        <section>
          <div className="agent-section-heading">
            <h3><Folder size={13} aria-hidden="true" /> 프로젝트</h3>
            <span>{workspaces.length}</span>
          </div>
          <form
            className="workspace-open"
            onSubmit={(event) => {
              event.preventDefault();
              if (path.trim()) onOpen(path.trim());
            }}
          >
            <input
              aria-label="Workspace 폴더 경로"
              placeholder="/path/to/project"
              value={path}
              onChange={(event) => setPath(event.target.value)}
            />
            <button type="submit" aria-label="Workspace 열기" title="Workspace 열기" disabled={!path.trim()}>
              <FolderOpen size={16} aria-hidden="true" />
            </button>
          </form>
          <div className="workspace-list">
            {workspaces.map((workspace) => (
              <button
                type="button"
                className={workspace.id === activeWorkspace?.id ? "active" : ""}
                key={workspace.id}
                title={workspace.rootPath}
                onClick={() => onSelect(workspace)}
              >
                <Folder size={14} aria-hidden="true" />
                <span>{workspace.name}</span>
              </button>
            ))}
            {workspaces.length === 0 ? <p>폴더 경로를 입력해 프로젝트를 연결하세요.</p> : null}
          </div>
        </section>

        <section className="agent-files">
          <div className="agent-section-heading">
            <h3><File size={13} aria-hidden="true" /> 파일</h3>
            <span>{files.length}</span>
          </div>
          <div className="agent-file-list">
            {files.map((entry) => (
              <div key={entry.path} title={entry.path}>
                {entry.isDirectory ? <Folder size={13} aria-hidden="true" /> : <File size={13} aria-hidden="true" />}
                <span>{entry.path}</span>
              </div>
            ))}
            {activeWorkspace && files.length === 0 ? <p>표시할 파일이 없습니다.</p> : null}
            {!activeWorkspace ? <p>프로젝트를 열면 파일이 표시됩니다.</p> : null}
          </div>
        </section>

        <section>
          <div className="agent-section-heading">
            <h3><History size={13} aria-hidden="true" /> 실행</h3>
            <span>{run?.steps.length ?? 0}</span>
          </div>
          {run ? (
            <div className="run-summary">
              <span className={`run-dot ${run.status}`} />
              <strong>{statusLabels[run.status]}</strong>
              <small>{run.steps.length}개 단계</small>
            </div>
          ) : (
            <p>아직 실행 기록이 없습니다.</p>
          )}
        </section>
      </aside>

      <section className="agent-main">
        <header className="agent-header">
          <div className="agent-title">
            <p className="eyebrow">LOCAL AGENT</p>
            <h2>{activeWorkspace?.name ?? "Workspace를 여세요"}</h2>
            {activeWorkspace ? <p className="agent-path" title={activeWorkspace.rootPath}>{activeWorkspace.rootPath}</p> : null}
          </div>
          {busy ? (
            <button type="button" className="stop-agent" onClick={onStop}>
              <Square size={14} aria-hidden="true" /> 중지
            </button>
          ) : null}
        </header>

        <div className="agent-activity">
          {run?.steps.map((step) => {
            const failed = step.toolResult?.success === false;
            const finished = Boolean(step.toolResult);
            return (
              <article className={`activity-row${failed ? " failed" : ""}`} key={step.id}>
                <span className="activity-status" aria-hidden="true">
                  {failed ? <X size={15} /> : finished ? <Check size={15} /> : <LoaderCircle className="spin" size={15} />}
                </span>
                <div>
                  <strong>{step.summary}</strong>
                  <small>{statusLabels[step.status]}</small>
                  {step.toolResult?.output ? (
                    <pre>{typeof step.toolResult.output === "string" ? step.toolResult.output : JSON.stringify(step.toolResult.output, null, 2)}</pre>
                  ) : null}
                </div>
              </article>
            );
          })}

          {run?.finalResponse ? (
            <article className="agent-final">
              <Check size={17} aria-hidden="true" />
              <div><strong>작업 완료</strong><p>{run.finalResponse}</p></div>
            </article>
          ) : null}

          {!run ? (
            <div className="agent-empty">
              {activeWorkspace ? <Play size={27} aria-hidden="true" /> : <FolderOpen size={27} aria-hidden="true" />}
              <h3>{activeWorkspace ? "Agent에게 첫 작업을 요청하세요" : "프로젝트 폴더를 연결하세요"}</h3>
              <p>
                {activeWorkspace
                  ? "필요한 파일만 확인하고 변경 전에는 정책과 승인 단계를 거칩니다."
                  : "좌측 탐색기에서 작업할 폴더 경로를 입력하면 시작할 수 있습니다."}
              </p>
            </div>
          ) : null}

          {diffs.map(({ id, diff }) => (
            <article className="diff-card" key={id}>
              <header>
                <strong>변경 내용</strong>
                {diffDecisions[id] ? <span>{diffDecisions[id] === "accepted" ? "적용됨" : "되돌림"}</span> : <div><button type="button" onClick={() => onRevertDiff(id, diff)}><RotateCcw size={13} aria-hidden="true" /> 되돌리기</button><button type="button" onClick={() => onAcceptDiff(id)}><Check size={13} aria-hidden="true" /> 적용</button></div>}
              </header>
              <pre>{diff}</pre>
            </article>
          ))}

          {error ? <div className="error-card agent-error" role="alert"><strong>{error}</strong></div> : null}
        </div>

        {approval ? (
          <div className="approval-card" role="alert">
            <div><strong>도구 실행 승인이 필요합니다</strong><code>{approval.toolRequest.tool}</code></div>
            <div>
              <button type="button" className="secondary" onClick={() => onApprove(false)}>거절</button>
              <button type="button" onClick={() => onApprove(true)}>승인</button>
            </div>
          </div>
        ) : null}

        <form className="agent-composer" onSubmit={submit}>
          <div className="agent-composer-input">
            <textarea
              rows={2}
              aria-label="Agent 작업"
              placeholder={activeWorkspace ? "Agent에게 작업을 설명하세요" : "먼저 Workspace를 열어주세요"}
              disabled={!activeWorkspace || busy}
              value={task}
              onChange={(event) => setTask(event.target.value)}
            />
            <span>{busy ? "작업을 처리하고 있습니다" : "작업 범위와 원하는 결과를 구체적으로 입력하세요"}</span>
          </div>
          <button type="submit" disabled={!activeWorkspace || busy || !task.trim()}>
            <Play size={15} aria-hidden="true" /> 실행
          </button>
        </form>
      </section>
    </main>
  );
}
