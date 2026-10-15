import type { Conversation } from "./types";

export function modelToUnloadAfterConversationRemoval(
  conversations: Conversation[],
  removedConversationId: string,
): string | null {
  const removed = conversations.find((conversation) => conversation.id === removedConversationId);
  if (!removed) return null;

  const modelStillInUse = conversations.some(
    (conversation) =>
      conversation.id !== removedConversationId && conversation.modelId === removed.modelId,
  );
  return modelStillInUse ? null : removed.modelId;
}
