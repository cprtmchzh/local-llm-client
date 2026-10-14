import { useEffect, useState } from "react";
import { MessageSquarePlus, MoreHorizontal, Settings, Trash2 } from "lucide-react";
import type { Conversation } from "../domain/types";
import { formatRelativeTime } from "../lib/utils";

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  compact?: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onSettings: () => void;
}

export function Sidebar({
  conversations,
  activeId,
  compact = false,
  onSelect,
  onNew,
  onDelete,
  onSettings,
}: SidebarProps) {
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null);

  useEffect(() => {
    if (!pendingDelete) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPendingDelete(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [pendingDelete]);

  return (
    <>
      <aside className={`sidebar${compact ? " sidebar-compact" : ""}`}>
        <button
          type="button"
          className="new-chat"
          title={compact ? "새 대화로 이동" : undefined}
          onClick={onNew}
        >
          <MessageSquarePlus size={17} aria-hidden="true" />
          <span>새 대화</span>
        </button>
        {compact ? (
          <div className="sidebar-spacer" />
        ) : (
          <>
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
                      title="대화 삭제"
                      onClick={(event) => {
                        event.stopPropagation();
                        setPendingDelete(conversation);
                      }}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                ))
              )}
            </nav>
          </>
        )}
        <button
          type="button"
          className="settings-link"
          title={compact ? "설정" : undefined}
          onClick={onSettings}
        >
          <Settings size={17} aria-hidden="true" />
          <span>설정</span>
        </button>
      </aside>

      {pendingDelete ? (
        <div
          className="dialog-backdrop confirm-backdrop"
          role="presentation"
          onMouseDown={() => setPendingDelete(null)}
        >
          <section
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            aria-describedby="delete-dialog-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="confirm-icon" aria-hidden="true">
              <Trash2 size={20} />
            </div>
            <h2 id="delete-dialog-title">대화를 삭제할까요?</h2>
            <p id="delete-dialog-description">
              “{pendingDelete.title}” 대화는 삭제 후 복구할 수 없습니다.
            </p>
            <footer>
              <button type="button" className="secondary" autoFocus onClick={() => setPendingDelete(null)}>
                취소
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => {
                  onDelete(pendingDelete.id);
                  setPendingDelete(null);
                }}
              >
                삭제
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
