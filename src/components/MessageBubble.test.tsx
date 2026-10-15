import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Message } from "../domain/types";
import { MessageBubble } from "./MessageBubble";

describe("MessageBubble", () => {
  it("renders inline references, warnings, and clickable sources", () => {
    const message: Message = {
      id: "message-1",
      conversationId: "conversation-1",
      role: "assistant",
      content: "검증된 내용입니다. [1]",
      createdAt: "2026-10-15T00:00:00.000Z",
      citations: [{ id: 1, title: "Example source", url: "https://example.com/source", snippet: "evidence" }],
      warnings: ["검색 일부가 제한되었습니다."],
      reasoning: { requested: "deep-review", resolved: "deep" },
    };
    render(<MessageBubble message={message} />);
    expect(screen.getByRole("link", { name: "[1]" })).toHaveAttribute("href", "https://example.com/source");
    expect(screen.getByRole("link", { name: /Example source/ })).toHaveAttribute("target", "_blank");
    expect(screen.getByText("검색 일부가 제한되었습니다.")).toBeInTheDocument();
    expect(screen.getByText("deep")).toBeInTheDocument();
  });

  it("shows user-safe deep review progress", () => {
    render(<MessageBubble message={{
      id: "message-2",
      conversationId: "conversation-1",
      role: "assistant",
      content: "",
      createdAt: "2026-10-15T00:00:00.000Z",
      pending: true,
      stage: "critiquing",
    }} />);
    expect(screen.getByText("초안의 정확성을 검토하는 중")).toBeInTheDocument();
  });
});
