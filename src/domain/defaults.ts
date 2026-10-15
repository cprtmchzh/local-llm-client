import type { AppSettings, LaunchProfile, ModelInfo } from "./types";
import models from "../../config/models.json";
import profiles from "../../config/launch-profiles.json";

export const defaultSettings: AppSettings = {
  mockMode: import.meta.env.VITE_MOCK_MODE !== "false",
  host: "",
  sshPort: 22,
  username: "",
  authentication: "key",
  privateKeyPath: "~/.ssh/id_ed25519",
  wakeProvider: "magic-packet",
  macAddress: "",
  broadcastAddress: "255.255.255.255:9",
  customWakeCommand: "",
  closeBehavior: "nothing",
  advancedMode: false,
  directApiMode: false,
  searchMode: "auto",
  reasoningMode: "normal",
  searchProvider: "tavily",
  searchMaxResults: 5,
  searchTimeoutMs: 12_000,
  modelTimeoutMs: 0,
};

export const defaultModels = models as ModelInfo[];

export const defaultProfiles = profiles as LaunchProfile[];

export const categoryLabels: Record<ModelInfo["category"], string> = {
  general: "General",
  coding: "Coding",
  security: "Security",
  agent: "Agent",
};
