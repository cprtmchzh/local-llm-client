import { Check, Copy, ExternalLink, Search } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../domain/types";
import { AppIcon } from "./AppIcon";

interface MessageBubbleProps {
  message: Message;
}

const stageLabels = {
  searching: "웹에서 근거를 찾는 중",
  drafting: "답변 초안을 작성하는 중",
  critiquing: "초안의 정확성을 검토하는 중",
  revising: "검토 결과를 반영하는 중",
  answering: "답변을 생성하는 중",
} as const;

function sourceLabel(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
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

  const citationById = new Map(message.citations?.map((citation) => [citation.id, citation]));
  const renderedContent = message.content.replace(/\[(\d+)\](?!\()/g, (match, id: string) => {
    const citation = citationById.get(Number(id));
    return citation ? `[[${id}]](${citation.url})` : match;
  });

  return (
    <article className="assistant-message">
      <div className="assistant-avatar"><AppIcon /></div>
      <div className="assistant-content">
        {message.pending && !message.content ? (
          <div className="response-stage" aria-live="polite">
            <div className="typing" aria-hidden="true"><i /><i /><i /></div>
            <span>{message.stage ? stageLabels[message.stage] : "응답을 준비하는 중"}</span>
          </div>
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
            {renderedContent}
          </ReactMarkdown>
        )}
        {message.reasoning ? (
          <div className="response-meta"><span>{message.reasoning.resolved}</span></div>
        ) : null}
        {message.warnings?.map((warning, index) => <div className="response-warning" key={`${index}:${warning}`}>{warning}</div>)}
        {message.citations?.length ? (
          <section className="message-sources" aria-label="출처">
            <strong><Search size={13} aria-hidden="true" /> 출처</strong>
            <ol>
              {message.citations.map((citation) => (
                <li key={citation.id}>
                  <a href={citation.url} target="_blank" rel="noreferrer">
                    <span>{citation.id}</span>
                    <div><strong>{citation.title}</strong><small>{citation.source ?? sourceLabel(citation.url)}</small></div>
                    <ExternalLink size={12} aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
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
