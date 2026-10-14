import { invoke } from "@tauri-apps/api/core";
import { PanelRight, RotateCw } from "lucide-react";
import { useState } from "react";
import { ChatView } from "./components/ChatView";
import { LogsPanel } from "./components/LogsPanel";
import { ModelSelector } from "./components/ModelSelector";
import { SettingsDialog } from "./components/SettingsDialog";
import { Sidebar } from "./components/Sidebar";
import { StatusPill } from "./components/StatusPill";
import type { AppSettings } from "./domain/types";
import { useAppController } from "./hooks/useAppController";
import { isTauri } from "./lib/utils";
import "./styles.css";

export default function App() {
  const app = useAppController();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);

  const saveSettings = async (settings: AppSettings, password: string) => {
    if (password && isTauri()) {
      await invoke("store_credential", { service: "local-llm-client.ssh", account: settings.username, secret: password });
    }
    app.saveSettings(settings);
  };

  return (
    <div className="app-shell">
      <Sidebar
        conversations={app.conversations}
        activeId={app.activeConversationId}
        onSelect={app.selectConversation}
        onNew={app.createConversation}
        onDelete={app.removeConversation}
        onSettings={() => setSettingsOpen(true)}
      />
      <section className="workspace">
        <header className="topbar">
          <ModelSelector
            models={app.models}
            selectedId={app.selectedModelId}
            disabled={app.isStreaming}
            onSelect={app.selectModel}
          />
          <div className="topbar-actions">
            {app.settings.mockMode ? <span className="mock-badge">MOCK</span> : null}
            <StatusPill state={app.connectionState} compact />
            <button type="button" className="icon-button" aria-label="다시 연결" onClick={() => void app.prepare()}><RotateCw size={17} /></button>
            {app.settings.advancedMode ? <button type="button" className="icon-button" aria-label="상세 로그" onClick={() => setLogsOpen((value) => !value)}><PanelRight size={17} /></button> : null}
          </div>
        </header>
        <ChatView
          conversation={app.activeConversation}
          model={app.selectedModel}
          error={app.error}
          isStreaming={app.isStreaming}
          onSend={(content) => void app.sendMessage(content)}
          onRetry={() => void app.prepare()}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </section>
      {logsOpen ? <LogsPanel logs={app.logs} onClose={() => setLogsOpen(false)} /> : null}
      {settingsOpen ? <SettingsDialog initial={app.settings} onSave={saveSettings} onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}
