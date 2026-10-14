import { ArrowUp, Square } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

interface ComposerProps {
  disabled: boolean;
  isStreaming: boolean;
  modelName: string;
  onSend: (content: string) => void;
}

export function Composer({ disabled, isStreaming, modelName, onSend }: ComposerProps) {
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
          aria-label={isStreaming ? "응답 생성 중" : "메시지 보내기"}
          disabled={disabled || !value.trim()}
          onClick={submit}
        >
          {isStreaming ? <Square size={15} fill="currentColor" /> : <ArrowUp size={18} />}
        </button>
      </div>
      <p>{modelName} · 로컬에서 처리됨</p>
    </div>
  );
}
