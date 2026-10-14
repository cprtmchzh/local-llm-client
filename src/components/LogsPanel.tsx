import { X } from "lucide-react";
import type { LogEntry } from "../domain/types";

interface LogsPanelProps {
  logs: LogEntry[];
  onClose: () => void;
}

export function LogsPanel({ logs, onClose }: LogsPanelProps) {
  return (
    <aside className="logs-panel" aria-label="상세 로그">
      <header><div><p className="eyebrow">ADVANCED</p><h2>Runtime logs</h2></div><button type="button" className="icon-button" aria-label="로그 닫기" onClick={onClose}><X size={18} /></button></header>
      <div className="log-stream">
        {logs.length === 0 ? <p className="log-empty">아직 로그가 없습니다.</p> : logs.map((entry) => <div className={`log-line ${entry.level}`} key={entry.id}><time>{new Date(entry.createdAt).toLocaleTimeString("ko-KR", { hour12: false })}</time><span>{entry.level.toUpperCase()}</span><p>{entry.message}</p></div>)}
      </div>
    </aside>
  );
}
