import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";

function renderComposer(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
  const props: Parameters<typeof Composer>[0] = {
    disabled: false,
    isStreaming: false,
    modelControl: <button type="button">Model</button>,
    searchMode: "auto",
    reasoningMode: "normal",
    onSend: vi.fn(),
    onCancel: vi.fn(),
    onSearchModeChange: vi.fn(),
    onReasoningModeChange: vi.fn(),
    ...overrides,
  };
  render(<Composer {...props} />);
  return props;
}

describe("Composer", () => {
  it("exposes search and reasoning mode controls", async () => {
    const user = userEvent.setup();
    const props = renderComposer();
    await user.selectOptions(screen.getByLabelText("웹 검색"), "on");
    await user.selectOptions(screen.getByLabelText("추론 모드"), "deep-review");
    expect(props.onSearchModeChange).toHaveBeenCalledWith("on");
    expect(props.onReasoningModeChange).toHaveBeenCalledWith("deep-review");
  });

  it("turns the submit button into an active cancellation control", async () => {
    const user = userEvent.setup();
    const props = renderComposer({ disabled: true, isStreaming: true });
    await user.click(screen.getByRole("button", { name: "응답 생성 취소" }));
    expect(props.onCancel).toHaveBeenCalledOnce();
  });
});
