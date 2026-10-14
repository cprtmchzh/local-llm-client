import { MessageSquarePlus, MoreHorizontal, Settings, Trash2 } from "lucide-react";
import type { Conversation } from "../domain/types";
import { formatRelativeTime } from "../lib/utils";
import { AppIcon } from "./AppIcon";

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onSettings: () => void;
}

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onSettings,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><AppIcon /></div>
        <span>Local LLM</span>
      </div>
      <button type="button" className="new-chat" onClick={onNew}>
        <MessageSquarePlus size={17} aria-hidden="true" />
        새 대화
      </button>
      <div className="conversation-heading">
        <span>최근 대화</span>
        <MoreHorizontal size={16} aria-hidden="true" />
      </div>
      <nav className="conversation-list" aria-label="대화 목록">
        {conversations.length === 0 ? (
          <div className="empty-history">아직 대화가 없습니다.</div>
        ) : (
          conversations.map((conversation) => (
            <div
              className={`conversation-row${conversation.id === activeId ? " active" : ""}`}
              key={conversation.id}
            >
              <button type="button" onClick={() => onSelect(conversation.id)}>
                <span>{conversation.title}</span>
                <small>{formatRelativeTime(conversation.updatedAt)}</small>
              </button>
              <button
                className="delete-chat"
                type="button"
                aria-label={`${conversation.title} 삭제`}
                onClick={() => onDelete(conversation.id)}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          ))
        )}
      </nav>
      <button type="button" className="settings-link" onClick={onSettings}>
        <Settings size={17} aria-hidden="true" />
        설정
      </button>
    </aside>
  );
}
