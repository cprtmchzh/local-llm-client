import type { ConnectionState } from "./types";

const transitions: Record<ConnectionState, readonly ConnectionState[]> = {
  offline: ["waking", "online", "error"],
  waking: ["online", "error"],
  online: ["ssh_connecting", "offline", "error"],
  ssh_connecting: ["ssh_ready", "offline", "error"],
  ssh_ready: ["runtime_starting", "model_loading", "offline", "error"],
  runtime_starting: ["model_loading", "model_ready", "error"],
  model_loading: ["model_ready", "error"],
  model_ready: ["runtime_starting", "model_loading", "offline", "error"],
  error: ["offline", "waking", "online", "ssh_connecting"],
};

export function canTransition(from: ConnectionState, to: ConnectionState): boolean {
  return from === to || transitions[from].includes(to);
}

export const stateLabels: Record<ConnectionState, string> = {
  offline: "오프라인",
  waking: "PC를 시작하는 중",
  online: "PC 온라인",
  ssh_connecting: "안전하게 연결하는 중",
  ssh_ready: "연결됨",
  runtime_starting: "모델 서버를 시작하는 중",
  model_loading: "모델을 불러오는 중",
  model_ready: "준비됨",
  error: "연결 확인 필요",
};
