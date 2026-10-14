import { useCallback, useMemo, useRef, useState } from "react";
import { defaultModels, defaultProfiles } from "../domain/defaults";
import { canTransition } from "../domain/connectionMachine";
import {
  AppError,
  type AppSettings,
  type ConnectionState,
  type Conversation,
  type LogEntry,
  type Message,
  type ModelInfo,
  type ProviderContext,
} from "../domain/types";
import { createId } from "../lib/utils";
import { ConnectionOrchestrator } from "../services/orchestrator";
import { getProviders } from "../services/providers";
import { appStorage } from "../services/storage";

function now(): string {
  return new Date().toISOString();
}

export function useAppController() {
  const [settings, setSettingsState] = useState<AppSettings>(() => appStorage.loadSettings());
  const [models, setModels] = useState<ModelInfo[]>(() => appStorage.loadModels());
  const [profiles] = useState(() => appStorage.loadProfiles());
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    appStorage.loadConversations(),
  );
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    () => appStorage.loadConversations()[0]?.id ?? null,
  );
  const [selectedModelId, setSelectedModelId] = useState(
    () => appStorage.loadConversations()[0]?.modelId ?? defaultModels[2].id,
  );
  const [connectionState, setConnectionState] = useState<ConnectionState>("offline");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<AppError | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const preparedContextRef = useRef<ProviderContext | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  );
  const selectedModel = models.find((model) => model.id === selectedModelId) ?? models[0];
  const selectedProfile =
    profiles.find((profile) => profile.id === selectedModel?.launchProfileId) ?? defaultProfiles[0];

  const log = useCallback((message: string, level: LogEntry["level"] = "info") => {
    setLogs((current) => [
      ...current.slice(-199),
      { id: createId(), message, level, createdAt: now() },
    ]);
  }, []);

  const transition = useCallback(
    (next: ConnectionState) => {
      setConnectionState((current) => {
        if (!canTransition(current, next)) {
          log(`Unexpected state transition: ${current} → ${next}`, "warn");
        }
        return next;
      });
    },
    [log],
  );

  const persistConversations = useCallback((update: (items: Conversation[]) => Conversation[]) => {
    setConversations((current) => {
      const next = update(current);
      appStorage.saveConversations(next);
      return next;
    });
  }, []);

  const createConversation = useCallback(() => {
    const timestamp = now();
    const conversation: Conversation = {
      id: createId(),
      title: "새 대화",
      modelId: selectedModelId,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
    };
    persistConversations((current) => [conversation, ...current]);
    setActiveConversationId(conversation.id);
    setError(null);
    return conversation;
  }, [persistConversations, selectedModelId]);

  const context = useMemo<ProviderContext | null>(
    () =>
      selectedModel && selectedProfile
        ? { settings, model: selectedModel, profile: selectedProfile }
        : null,
    [selectedModel, selectedProfile, settings],
  );

  const prepare = useCallback(async () => {
    if (!context) return;
    setError(null);
    const providers = getProviders(settings);
    const orchestrator = new ConnectionOrchestrator(providers, {
      setState: transition,
      log,
    });
    try {
      const previous = preparedContextRef.current;
      if (previous && previous.model.id !== context.model.id) {
        transition("runtime_starting");
        log(`Switching model ${previous.model.id} → ${context.model.id}`);
        await providers.runtime.stop(previous);
      }
      await orchestrator.prepare(context);
      preparedContextRef.current = context;
    } catch (caught) {
      setError(
        caught instanceof AppError
          ? caught
          : new AppError(String(caught), "UNKNOWN", "다시 시도하세요."),
      );
      throw caught;
    }
  }, [context, log, settings, transition]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || !context || isStreaming) return;
      const conversation = activeConversation ?? createConversation();
      const createdAt = now();
      const userMessage: Message = {
        id: createId(),
        conversationId: conversation.id,
        role: "user",
        content: content.trim(),
        createdAt,
      };
      const assistantMessage: Message = {
        id: createId(),
        conversationId: conversation.id,
        role: "assistant",
        content: "",
        createdAt,
        pending: true,
      };
      const baseMessages = [...conversation.messages, userMessage];
      persistConversations((items) =>
        items.map((item) =>
          item.id === conversation.id
            ? {
                ...item,
                title: item.messages.length === 0 ? content.trim().slice(0, 36) : item.title,
                modelId: selectedModelId,
                updatedAt: createdAt,
                messages: [...baseMessages, assistantMessage],
              }
            : item,
        ),
      );

      setIsStreaming(true);
      setError(null);
      try {
        if (connectionState !== "model_ready") await prepare();
        const providers = getProviders(settings);
        await providers.model.streamChat(
          {
            requestId: assistantMessage.id,
            baseUrl: context.profile.apiBaseUrl.replaceAll("{host}", context.settings.host),
            model: context.model.modelPath,
            temperature: context.profile.temperature,
            messages: baseMessages.map(({ role, content: messageContent }) => ({
              role,
              content: messageContent,
            })),
          },
          (token) =>
            persistConversations((items) =>
              items.map((item) =>
                item.id === conversation.id
                  ? {
                      ...item,
                      updatedAt: now(),
                      messages: item.messages.map((message) =>
                        message.id === assistantMessage.id
                          ? { ...message, content: message.content + token }
                          : message,
                      ),
                    }
                  : item,
              ),
            ),
        );
        persistConversations((items) =>
          items.map((item) =>
            item.id === conversation.id
              ? {
                  ...item,
                  messages: item.messages.map((message) =>
                    message.id === assistantMessage.id ? { ...message, pending: false } : message,
                  ),
                }
              : item,
          ),
        );
      } catch (caught) {
        const appError =
          caught instanceof AppError
            ? caught
            : new AppError(
                caught instanceof Error ? caught.message : "응답 스트리밍이 중단되었습니다.",
                "STREAM_INTERRUPTED",
                "연결을 확인하고 메시지를 다시 보내세요.",
              );
        setError(appError);
        persistConversations((items) =>
          items.map((item) =>
            item.id === conversation.id
              ? {
                  ...item,
                  messages: item.messages.map((message) =>
                    message.id === assistantMessage.id
                      ? { ...message, pending: false, content: message.content || "응답을 받지 못했습니다." }
                      : message,
                  ),
                }
              : item,
          ),
        );
      } finally {
        setIsStreaming(false);
      }
    },
    [
      activeConversation,
      connectionState,
      context,
      createConversation,
      isStreaming,
      persistConversations,
      prepare,
      selectedModelId,
      settings,
    ],
  );

  const selectModel = useCallback(
    async (modelId: string) => {
      setSelectedModelId(modelId);
      setError(null);
      if (activeConversationId) {
        persistConversations((items) =>
          items.map((item) =>
            item.id === activeConversationId ? { ...item, modelId, updatedAt: now() } : item,
          ),
        );
      }
      transition(connectionState === "model_ready" ? "runtime_starting" : connectionState);
    },
    [activeConversationId, connectionState, persistConversations, transition],
  );

  const saveSettings = useCallback((next: AppSettings) => {
    appStorage.saveSettings(next);
    setSettingsState(next);
    setConnectionState("offline");
    preparedContextRef.current = null;
    setError(null);
  }, []);

  const removeConversation = useCallback(
    (id: string) => {
      persistConversations((items) => items.filter((item) => item.id !== id));
      if (activeConversationId === id) setActiveConversationId(null);
    },
    [activeConversationId, persistConversations],
  );

  const selectConversation = useCallback(
    (id: string) => {
      const conversation = conversations.find((item) => item.id === id);
      if (!conversation) return;
      setActiveConversationId(id);
      setSelectedModelId(conversation.modelId);
      setError(null);
    },
    [conversations],
  );

  const saveModel = useCallback((model: ModelInfo) => {
    setModels((current) => {
      const next = current.some((item) => item.id === model.id)
        ? current.map((item) => (item.id === model.id ? model : item))
        : [...current, model];
      appStorage.saveModels(next);
      return next;
    });
  }, []);

  return {
    settings,
    models,
    conversations,
    activeConversation,
    activeConversationId,
    selectedModel,
    selectedModelId,
    connectionState,
    logs,
    error,
    isStreaming,
    selectConversation,
    createConversation,
    removeConversation,
    selectModel,
    saveSettings,
    saveModel,
    sendMessage,
    prepare,
  };
}
