import { invoke } from "@tauri-apps/api/core";
import { Bot, MessageSquare, PanelRight, RotateCw } from "lucide-react";
import { useState } from "react";
import { ChatView } from "./components/ChatView";
import { AgentWorkspace } from "./components/AgentWorkspace";
import { LogsPanel } from "./components/LogsPanel";
import { ModelSelector } from "./components/ModelSelector";
import { SettingsDialog } from "./components/SettingsDialog";
import { Sidebar } from "./components/Sidebar";
import { StatusPill } from "./components/StatusPill";
import type { AppSettings } from "./domain/types";
import { useAppController } from "./hooks/useAppController";
import { useAgentController } from "./hooks/useAgentController";
import { isTauri } from "./lib/utils";
import "./styles.css";

export default function App() {
  const app = useAppController();
  const agent = useAgentController(app.context, app.settings, app.prepare);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [mode, setMode] = useState<"chat" | "agent">("chat");

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
        compact={mode === "agent"}
        onSelect={app.selectConversation}
        onNew={() => {
          app.createConversation();
          setMode("chat");
        }}
        onDelete={app.removeConversation}
        onSettings={() => setSettingsOpen(true)}
      />
      <section className="workspace">
        <header className="topbar">
          <div className="topbar-primary">
            <div className="mode-switch" role="group" aria-label="작업 모드">
              <button
                type="button"
                className={mode === "chat" ? "active" : ""}
                aria-pressed={mode === "chat"}
                onClick={() => setMode("chat")}
              >
                <MessageSquare size={14} aria-hidden="true" /> Chat
              </button>
              <button
                type="button"
                className={mode === "agent" ? "active" : ""}
                aria-pressed={mode === "agent"}
                onClick={() => setMode("agent")}
              >
                <Bot size={14} aria-hidden="true" /> Agent
              </button>
            </div>
            <ModelSelector
              models={app.models}
              selectedId={app.selectedModelId}
              disabled={app.isStreaming}
              onSelect={app.selectModel}
            />
          </div>
          <div className="topbar-actions">
            {app.settings.mockMode ? <span className="mock-badge">MOCK</span> : null}
            <StatusPill state={app.connectionState} compact />
            <button type="button" className="icon-button" aria-label="다시 연결" title="다시 연결" onClick={() => void app.prepare()}><RotateCw size={17} /></button>
            {app.settings.advancedMode ? <button type="button" className="icon-button" aria-label={logsOpen ? "상세 로그 닫기" : "상세 로그 열기"} aria-pressed={logsOpen} title={logsOpen ? "상세 로그 닫기" : "상세 로그 열기"} onClick={() => setLogsOpen((value) => !value)}><PanelRight size={17} /></button> : null}
          </div>
        </header>
        {mode === "chat" ? <ChatView
          conversation={app.activeConversation}
          model={app.selectedModel}
          error={app.error}
          isStreaming={app.isStreaming}
          onSend={(content) => void app.sendMessage(content)}
          onRetry={() => void app.prepare()}
          onOpenSettings={() => setSettingsOpen(true)}
        /> : (
          <AgentWorkspace
            workspaces={agent.workspaces}
            activeWorkspace={agent.activeWorkspace}
            files={agent.files}
            run={agent.run}
            approval={agent.approval}
            error={agent.error}
            isStarting={agent.isStarting}
            diffDecisions={agent.diffDecisions}
            onOpen={(path) => void agent.openWorkspace(path)}
            onSelect={(workspace) => void agent.selectWorkspace(workspace)}
            onStart={(task) => void agent.start(task)}
            onStop={agent.stop}
            onApprove={agent.resolveApproval}
            onAcceptDiff={agent.acceptDiff}
            onRevertDiff={(id, diff) => void agent.revertDiff(id, diff)}
          />
        )}
      </section>
      {logsOpen ? <LogsPanel logs={app.logs} onClose={() => setLogsOpen(false)} /> : null}
      {settingsOpen ? <SettingsDialog initial={app.settings} onSave={saveSettings} onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}
