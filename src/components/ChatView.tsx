import { ArrowRight, Code2, ShieldCheck, Zap } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import type { AppError, Conversation, ModelInfo } from "../domain/types";
import { AppIcon } from "./AppIcon";
import { Composer } from "./Composer";
import { MessageBubble } from "./MessageBubble";

interface ChatViewProps {
  conversation: Conversation | null;
  model: ModelInfo;
  error: AppError | null;
  isStreaming: boolean;
  modelControl: ReactNode;
  onSend: (content: string) => void;
  onRetry: () => void;
  onOpenSettings: () => void;
}

const suggestions = [
  { icon: ShieldCheck, label: "보안 분석", prompt: "OWASP Juice Shop을 안전하게 분석하는 계획을 만들어줘" },
  { icon: Code2, label: "코드 리뷰", prompt: "안전한 API 코드 리뷰 체크리스트를 만들어줘" },
  { icon: Zap, label: "빠른 시작", prompt: "이 모델로 할 수 있는 일을 간단히 알려줘" },
];

export function ChatView({
  conversation,
  model,
  error,
  isStreaming,
  modelControl,
  onSend,
  onRetry,
  onOpenSettings,
}: ChatViewProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages]);

  const hasMessages = Boolean(conversation?.messages.length);

  return (
    <main className="chat-main">
      <div className="messages-scroll">
        {!hasMessages ? (
          <section className="welcome">
            <div className="welcome-icon"><AppIcon /></div>
            <p className="eyebrow">PRIVATE · LOCAL · YOURS</p>
            <h1>무엇을 함께 해볼까요?</h1>
            <p className="welcome-copy">
              {model.name}이 원격 Windows에서 준비됩니다.<br />
              복잡한 연결 과정은 앱이 알아서 처리해요.
            </p>
            <div className="suggestions">
              {suggestions.map(({ icon: Icon, label, prompt }) => (
                <button type="button" key={label} onClick={() => onSend(prompt)}>
                  <Icon size={17} aria-hidden="true" />
                  <span><strong>{label}</strong><small>{prompt}</small></span>
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        ) : (
          <section className="message-list" aria-live="polite">
            {conversation?.messages.map((message) => (
              <MessageBubble message={message} key={message.id} />
            ))}
            <div ref={endRef} />
          </section>
        )}
        {error ? (
          <div className="error-card" role="alert">
            <div>
              <strong>{error.message}</strong>
              <span>{error.recovery}</span>
            </div>
            <div>
              <button type="button" onClick={onRetry}>다시 연결</button>
              <button type="button" className="secondary" onClick={onOpenSettings}>연결 설정</button>
            </div>
          </div>
        ) : null}
      </div>
      <Composer
        disabled={isStreaming}
        isStreaming={isStreaming}
        modelControl={modelControl}
        onSend={onSend}
      />
    </main>
  );
}
