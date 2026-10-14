export type ConnectionState =
  | "offline"
  | "waking"
  | "online"
  | "ssh_connecting"
  | "ssh_ready"
  | "runtime_starting"
  | "model_loading"
  | "model_ready"
  | "error";

export type ModelCategory = "general" | "coding" | "security" | "agent";

export interface ModelInfo {
  id: string;
  name: string;
  category: ModelCategory;
  runtimeId: string;
  modelPath: string;
  contextLength: number;
  launchProfileId: string;
  description: string;
}

export interface LaunchProfile {
  id: string;
  runtimeId: string;
  command: string;
  port: number;
  healthEndpoint: string;
  apiBaseUrl: string;
  contextSize: number;
  gpuLayers: number;
  threads: number;
  batchSize: number;
  temperature: number;
  additionalArguments: string[];
}

export interface AppSettings {
  mockMode: boolean;
  host: string;
  sshPort: number;
  username: string;
  authentication: "password" | "key";
  privateKeyPath: string;
  wakeProvider: "magic-packet" | "custom";
  macAddress: string;
  broadcastAddress: string;
  customWakeCommand: string;
  closeBehavior: "nothing" | "stop-runtime" | "sleep-windows";
  advancedMode: boolean;
}

export type MessageRole = "user" | "assistant" | "system";

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  pending?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

export interface LogEntry {
  id: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  createdAt: string;
}

export interface ChatRequest {
  requestId: string;
  baseUrl: string;
  model: string;
  temperature: number;
  messages: Pick<Message, "role" | "content">[];
}

export interface ProviderContext {
  settings: AppSettings;
  model: ModelInfo;
  profile: LaunchProfile;
}

export class AppError extends Error {
  constructor(
    message: string,
    readonly code:
      | "WAKE_FAILED"
      | "SSH_TIMEOUT"
      | "SSH_AUTH_FAILED"
      | "RUNTIME_FAILED"
      | "MODEL_TIMEOUT"
      | "STREAM_INTERRUPTED"
      | "NETWORK_DISCONNECTED"
      | "INVALID_CONFIGURATION"
      | "UNKNOWN",
    readonly recovery: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}
