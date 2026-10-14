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

export function ModelSelector({ models, selectedId, disabled, onSelect }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = models.find((model) => model.id === selectedId);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className="model-selector" ref={containerRef}>
      <button
        className="model-trigger"
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="model-icon"><Cpu size={16} aria-hidden="true" /></span>
        <span>{selected?.name ?? "모델 선택"}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div className="model-menu" role="listbox" aria-label="사용할 모델">
          {(["general", "coding", "security", "agent"] as const).map((category) => {
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
                    <span>
                      <strong>{model.name}</strong>
                      <small>{model.description}</small>
                    </span>
                    {model.id === selectedId ? <Check size={16} aria-hidden="true" /> : null}
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
