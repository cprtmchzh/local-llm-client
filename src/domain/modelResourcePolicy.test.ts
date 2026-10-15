import { describe, expect, it } from "vitest";
import type { Conversation } from "./types";
import { modelToUnloadAfterConversationRemoval } from "./modelResourcePolicy";

function conversation(id: string, modelId: string): Conversation {
  return {
    id,
    modelId,
    title: id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messages: [],
  };
}

describe("modelToUnloadAfterConversationRemoval", () => {
  it("unloads the model when its last conversation is removed", () => {
    expect(
      modelToUnloadAfterConversationRemoval(
        [conversation("cyber", "qwen-cyber-27b"), conversation("general", "qwen-general")],
        "cyber",
      ),
    ).toBe("qwen-cyber-27b");
  });

  it("keeps a shared model loaded while another conversation uses it", () => {
    expect(
      modelToUnloadAfterConversationRemoval(
        [conversation("first", "qwen-cyber-27b"), conversation("second", "qwen-cyber-27b")],
        "first",
      ),
    ).toBeNull();
  });

  it("does nothing for an unknown conversation", () => {
    expect(modelToUnloadAfterConversationRemoval([], "missing")).toBeNull();
  });
});
