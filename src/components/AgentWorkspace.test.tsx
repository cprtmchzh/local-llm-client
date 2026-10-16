import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Workspace } from "../domain/workspace";
import { AgentWorkspace } from "./AgentWorkspace";

const workspace: Workspace = {
  id: "workspace-1",
  name: "local-project",
  rootPath: "/mock/local-project",
  createdAt: "2026-10-15T00:00:00.000Z",
  lastOpenedAt: "2026-10-15T00:00:00.000Z",
};

function renderAgent(activeWorkspace: Workspace | null = workspace) {
  const onBrowse = vi.fn();
  render(
    <AgentWorkspace
      workspaces={[workspace]}
      activeWorkspace={activeWorkspace}
      files={[]}
      run={null}
      approval={null}
      error={null}
      isStarting={false}
      diffDecisions={{}}
      modelControl={<button type="button">테스트 모델</button>}
      onBrowse={onBrowse}
      onSelect={vi.fn()}
      onStart={vi.fn()}
      onStop={vi.fn()}
      onApprove={vi.fn()}
      onAcceptDiff={vi.fn()}
      onRevertDiff={vi.fn()}
    />,
  );
  return { onBrowse };
}

describe("AgentWorkspace", () => {
  it("keeps the work area wide until the project explorer is requested", async () => {
    const user = userEvent.setup();
    renderAgent();

    expect(screen.queryByRole("complementary", { name: "Agent 탐색기" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "프로젝트 탐색기 열기" }));
    const explorer = screen.getByRole("complementary", { name: "Agent 탐색기" });
    expect(explorer).toBeInTheDocument();

    await user.click(within(explorer).getByRole("button", { name: "프로젝트 탐색기 닫기" }));
    expect(screen.queryByRole("complementary", { name: "Agent 탐색기" })).not.toBeInTheDocument();
  });

  it("opens the explorer initially when no workspace is connected", () => {
    renderAgent(null);

    expect(screen.getByRole("complementary", { name: "Agent 탐색기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "테스트 모델" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Workspace 폴더 경로" })).not.toBeInTheDocument();
  });

  it("opens the native project folder picker", async () => {
    const user = userEvent.setup();
    const { onBrowse } = renderAgent(null);

    await user.click(screen.getByRole("button", { name: "프로젝트 폴더 선택" }));

    expect(onBrowse).toHaveBeenCalledOnce();
  });
});
