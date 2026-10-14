import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Conversation } from "../domain/types";
import { Sidebar } from "./Sidebar";

const conversation: Conversation = {
  id: "conversation-1",
  title: "테스트 대화",
  modelId: "qwen-cyber-27b",
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
  messages: [],
};

function renderSidebar(onDelete = vi.fn()) {
  render(
    <Sidebar
      conversations={[conversation]}
      activeId={conversation.id}
      onSelect={vi.fn()}
      onNew={vi.fn()}
      onDelete={onDelete}
      onSettings={vi.fn()}
    />,
  );
  return onDelete;
}

describe("Sidebar", () => {
  it("uses a compact navigation rail in agent mode", () => {
    render(
      <Sidebar
        conversations={[conversation]}
        activeId={conversation.id}
        compact
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onSettings={vi.fn()}
      />,
    );

    expect(screen.getByRole("complementary")).toHaveClass("sidebar-compact");
    expect(screen.queryByRole("navigation", { name: "대화 목록" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "새 대화" })).toHaveAttribute("title", "새 대화로 이동");
  });

  it("asks for confirmation before deleting a conversation", async () => {
    const user = userEvent.setup();
    const onDelete = renderSidebar();

    await user.click(screen.getByRole("button", { name: "테스트 대화 삭제" }));

    const dialog = screen.getByRole("alertdialog", { name: "대화를 삭제할까요?" });
    expect(dialog).toHaveTextContent("삭제 후 복구할 수 없습니다");
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "삭제" }));
    expect(onDelete).toHaveBeenCalledWith(conversation.id);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("cancels deletion with Escape", async () => {
    const user = userEvent.setup();
    const onDelete = renderSidebar();

    await user.click(screen.getByRole("button", { name: "테스트 대화 삭제" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });
});
