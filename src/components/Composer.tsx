import { ArrowUp, Brain, Search, Square } from "lucide-react";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import type { ReasoningMode, SearchMode } from "../domain/types";

interface ComposerProps {
  disabled: boolean;
  isStreaming: boolean;
  modelControl: ReactNode;
  searchMode: SearchMode;
  reasoningMode: ReasoningMode;
  onSend: (content: string) => void;
  onCancel: () => void;
  onSearchModeChange: (mode: SearchMode) => void;
  onReasoningModeChange: (mode: ReasoningMode) => void;
}

export function Composer({
  disabled,
  isStreaming,
  modelControl,
  searchMode,
  reasoningMode,
  onSend,
  onCancel,
  onSearchModeChange,
  onReasoningModeChange,
}: ComposerProps) {
  const [value, setValue] = useState("");

  const submit = () => {
    if (!value.trim() || disabled) return;
    onSend(value);
    setValue("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="composer-wrap">
      <div className="composer">
        <div className="composer-input-row">
          <textarea
            value={value}
            disabled={isStreaming}
            rows={1}
            placeholder="무엇이든 물어보세요"
            aria-label="메시지"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            aria-label={isStreaming ? "응답 생성 취소" : "메시지 보내기"}
            disabled={!isStreaming && (disabled || !value.trim())}
            onClick={isStreaming ? onCancel : submit}
          >
            {isStreaming ? <Square size={15} fill="currentColor" /> : <ArrowUp size={18} />}
          </button>
        </div>
        <footer className="composer-footer">
          {modelControl}
          <div className="chat-mode-controls">
            <label title="웹 검색 모드">
              <Search size={13} aria-hidden="true" />
              <span className="sr-only">웹 검색</span>
              <select value={searchMode} disabled={isStreaming} onChange={(event) => onSearchModeChange(event.target.value as SearchMode)}>
                <option value="off">검색 끔</option>
                <option value="auto">검색 자동</option>
                <option value="on">검색 켬</option>
              </select>
            </label>
            <label title="추론 모드">
              <Brain size={13} aria-hidden="true" />
              <span className="sr-only">추론 모드</span>
              <select value={reasoningMode} disabled={isStreaming} onChange={(event) => onReasoningModeChange(event.target.value as ReasoningMode)}>
                <option value="fast">빠르게</option>
                <option value="normal">일반</option>
                <option value="deep">깊게</option>
                <option value="deep-review">깊게 + 검토</option>
              </select>
            </label>
          </div>
          <span>로컬에서 처리됨</span>
        </footer>
      </div>
    </div>
  );
}
