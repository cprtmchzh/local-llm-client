import { CircleAlert, LoaderCircle, MonitorCheck } from "lucide-react";
import { stateLabels } from "../domain/connectionMachine";
import type { ConnectionState } from "../domain/types";

interface StatusPillProps {
  state: ConnectionState;
  compact?: boolean;
}

const busyStates = new Set<ConnectionState>([
  "waking",
  "ssh_connecting",
  "runtime_starting",
  "model_loading",
]);

export function StatusPill({ state, compact = false }: StatusPillProps) {
  const isBusy = busyStates.has(state);
  const Icon = state === "error" ? CircleAlert : state === "model_ready" ? MonitorCheck : LoaderCircle;

  return (
    <div className={`status-pill status-${state}${compact ? " compact" : ""}`} role="status">
      <Icon aria-hidden="true" className={isBusy ? "spin" : ""} size={compact ? 13 : 15} />
      <span>{stateLabels[state]}</span>
    </div>
  );
}
