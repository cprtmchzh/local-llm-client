import { defaultModels, defaultProfiles, defaultSettings } from "../domain/defaults";
import type { AppSettings, Conversation, LaunchProfile, ModelInfo } from "../domain/types";

const keys = {
  settings: "local-llm.settings.v1",
  conversations: "local-llm.conversations.v1",
  models: "local-llm.models.v1",
  profiles: "local-llm.profiles.v1",
};

function read<T>(key: string, fallback: T): T {
  try {
    const serialized = localStorage.getItem(key);
    return serialized ? (JSON.parse(serialized) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export const appStorage = {
  loadSettings(): AppSettings {
    return { ...defaultSettings, ...read<Partial<AppSettings>>(keys.settings, {}) };
  },
  saveSettings(settings: AppSettings): void {
    write(keys.settings, settings);
  },
  loadConversations(): Conversation[] {
    return read<Conversation[]>(keys.conversations, []);
  },
  saveConversations(conversations: Conversation[]): void {
    write(keys.conversations, conversations);
  },
  loadModels(): ModelInfo[] {
    return read<ModelInfo[]>(keys.models, defaultModels);
  },
  saveModels(models: ModelInfo[]): void {
    write(keys.models, models);
  },
  loadProfiles(): LaunchProfile[] {
    return read<LaunchProfile[]>(keys.profiles, defaultProfiles);
  },
};
