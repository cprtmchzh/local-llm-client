import { defaultModels, defaultProfiles, defaultSettings } from "../domain/defaults";
import type { AppSettings, Conversation, LaunchCommand, LaunchProfile, ModelInfo } from "../domain/types";
import type { Workspace } from "../domain/workspace";

const keys = {
  settings: "local-llm.settings.v1",
  conversations: "local-llm.conversations.v1",
  models: "local-llm.models.v1",
  profiles: "local-llm.profiles.v1",
  workspaces: "local-llm.workspaces.v1",
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
    const stored = read<Array<LaunchProfile | (Omit<LaunchProfile, "launch"> & { command?: string })>>(
      keys.profiles,
      defaultProfiles,
    );
    return stored.map((profile) => {
      if ("launch" in profile) return profile;
      return { ...profile, launch: migrateCommand(profile.command) } as LaunchProfile;
    });
  },
  loadWorkspaces(): Workspace[] {
    return read<Workspace[]>(keys.workspaces, []);
  },
  saveWorkspaces(workspaces: Workspace[]): void {
    write(keys.workspaces, workspaces);
  },
};

function migrateCommand(command?: string): LaunchCommand | null {
  if (!command?.trim()) return null;
  const tokens = command.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((token) =>
    token.startsWith('"') && token.endsWith('"') ? token.slice(1, -1) : token,
  );
  if (!tokens?.length) return null;
  const [executable, ...args] = tokens;
  return { executable, args };
}
