import { Check, ChevronDown, Cpu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { categoryLabels } from "../domain/defaults";
import type { ModelInfo } from "../domain/types";

interface ModelSelectorProps {
  models: ModelInfo[];
  selectedId: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
}

const modelCategories = ["general", "coding", "security", "agent"] as const;

export function ModelSelector({ models, selectedId, disabled, onSelect }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = models.find((model) => model.id === selectedId);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <div className="model-selector" ref={containerRef}>
      <button
        className="model-trigger"
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={`모델 선택: ${selected?.name ?? "선택되지 않음"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="model-menu"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="model-icon"><Cpu size={16} aria-hidden="true" /></span>
        <span className="model-trigger-copy">
          <small>MODEL</small>
          <strong>{selected?.name ?? "모델 선택"}</strong>
        </span>
        {selected ? <span className="model-trigger-category">{categoryLabels[selected.category]}</span> : null}
        <ChevronDown className={`model-chevron${open ? " open" : ""}`} size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div className="model-menu" id="model-menu" role="listbox" aria-label="사용할 모델">
          <header className="model-menu-header">
            <span>
              <strong>모델 선택</strong>
              <small>현재 작업에 사용할 로컬 모델</small>
            </span>
            <span className="model-count">{models.length}</span>
          </header>
          {modelCategories.map((category) => {
            const items = models.filter((model) => model.category === category);
            return items.length > 0 ? (
              <div className="model-group" key={category}>
                <div className="model-group-label">{categoryLabels[category]}</div>
                {items.map((model) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={model.id === selectedId}
                    className="model-option"
                    key={model.id}
                    onClick={() => {
                      onSelect(model.id);
                      setOpen(false);
                    }}
                  >
                    <span className="model-option-copy">
                      <strong>{model.name}</strong>
                      <small>{model.description}</small>
                    </span>
                    <span className="model-option-status" aria-hidden="true">
                      {model.id === selectedId ? <Check size={15} /> : null}
                    </span>
                  </button>
                ))}
              </div>
            ) : null;
          })}
        </div>
      ) : null}
    </div>
  );
}
