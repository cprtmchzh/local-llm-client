import { Check, Copy } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../domain/types";
import { AppIcon } from "./AppIcon";

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  if (message.role === "user") {
    return <div className="user-message">{message.content}</div>;
  }

  return (
    <article className="assistant-message">
      <div className="assistant-avatar"><AppIcon /></div>
      <div className="assistant-content">
        {message.pending && !message.content ? (
          <div className="typing" aria-label="응답 생성 중"><i /><i /><i /></div>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const block = className?.includes("language-");
                return block ? (
                  <div className="code-block">
                    <div className="code-label">{className?.replace("language-", "")}</div>
                    <code className={className} {...props}>{children}</code>
                  </div>
                ) : <code className={className} {...props}>{children}</code>;
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        )}
        {message.content ? (
          <button type="button" className="copy-answer" onClick={copy}>
            {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            {copied ? "복사됨" : "복사"}
          </button>
        ) : null}
      </div>
    </article>
  );
}
