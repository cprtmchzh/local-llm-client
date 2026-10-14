import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { defaultModels } from "../domain/defaults";
import { ModelSelector } from "./ModelSelector";

describe("ModelSelector", () => {
  it("groups models and announces a selection", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ModelSelector
        models={defaultModels}
        selectedId="qwen-cyber-27b"
        onSelect={onSelect}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Qwen Cyber 27B/ }));
    expect(screen.getByRole("listbox", { name: "사용할 모델" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /Qwen Coder/ }));
    expect(onSelect).toHaveBeenCalledWith("qwen-coder");
  });
});
