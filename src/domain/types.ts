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

export type SearchMode = "off" | "auto" | "on";
export type SearchProviderMode = "searxng-tavily" | "searxng" | "tavily";
export type ReasoningMode = "fast" | "normal" | "deep" | "deep-review";
export type ChatStage = "searching" | "drafting" | "critiquing" | "revising" | "answering";

export interface ModelCapabilities {
  reasoningModes: ReasoningMode[];
}

export interface ModelInfo {
  id: string;
  name: string;
  category: ModelCategory;
  runtimeId: string;
  modelPath: string;
  contextLength: number;
  launchProfileId: string;
  description: string;
  capabilities?: ModelCapabilities;
}

export interface LaunchProfile {
  id: string;
  runtimeId: string;
  launch: LaunchCommand | null;
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

export interface LaunchCommand {
  executable: string;
  args: string[];
}

export type RuntimeStatus = "starting" | "running" | "stopped" | "crashed";

export interface RuntimeInstance {
  pid: number;
  modelId: string;
  port: number;
  startedAt: string;
  status: RuntimeStatus;
  ownedByApp: boolean;
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
  directApiMode: boolean;
  searchMode: SearchMode;
  reasoningMode: ReasoningMode;
  searchProvider: SearchProviderMode;
  searxngBaseUrl: string;
  searchMaxResults: number;
  searchTimeoutMs: number;
  modelTimeoutMs: number;
}

export type MessageRole = "user" | "assistant" | "system";

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  pending?: boolean;
  stage?: ChatStage;
  citations?: Citation[];
  warnings?: string[];
  reasoning?: {
    requested: ReasoningMode;
    resolved: ReasoningMode;
    fallback?: string;
  };
}

export interface Citation {
  id: number;
  title: string;
  url: string;
  snippet: string;
  source?: string;
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
  maxTokens: number;
  timeoutMs: number;
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
      | "REQUEST_TIMEOUT"
      | "REQUEST_CANCELLED"
      | "SEARCH_FAILED"
      | "UNKNOWN",
    readonly recovery: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}
