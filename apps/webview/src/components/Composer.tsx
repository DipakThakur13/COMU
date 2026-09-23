import { useEffect, useRef } from "react";
import type { ProviderConfig, TaskAutonomy, TaskMode } from "@comu/protocol";
import { Button, Icon } from "./primitives/index.js";
import styles from "./composer.module.css";

const MODES: Array<{ value: TaskMode; label: string; hint: string }> = [
  { value: "AUTO", label: "Auto", hint: "Classify the request" },
  { value: "AGENT", label: "Agent", hint: "Make the changes" },
  { value: "PLAN", label: "Plan", hint: "Design without changing anything" },
  { value: "ASK", label: "Ask", hint: "Investigate, read only" },
  { value: "CHAT", label: "Chat", hint: "Conversation, no tools" }
];

const AUTONOMY: Array<{ value: TaskAutonomy; label: string; hint: string }> = [
  { value: "ask", label: "Ask first", hint: "Approve every write and command" },
  { value: "auto", label: "Auto", hint: "No approvals, except pushing" },
  { value: "readonly", label: "Read only", hint: "Never write or run anything" }
];

export interface ComposerProps {
  text: string;
  mode: TaskMode;
  autonomy: TaskAutonomy;
  modelId?: string;
  providers: ProviderConfig[];
  busy: boolean;
  onText: (text: string) => void;
  onMode: (mode: TaskMode) => void;
  onAutonomy: (autonomy: TaskAutonomy) => void;
  onModel: (modelId: string) => void;
  onSubmit: () => void;
}

/**
 * One input with a single compact control row.
 *
 * The old composer stacked three full-width selects under a one-line input, so the controls
 * dominated the thing they configure. These sit inline and wrap only when the panel is genuinely
 * too narrow. Autonomy is always readable, because it now governs whether the agent writes
 * without asking.
 */
export function Composer({
  text,
  mode,
  autonomy,
  modelId,
  providers,
  busy,
  onText,
  onMode,
  onAutonomy,
  onModel,
  onSubmit
}: ComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const usable = providers.filter(p => p.hasCredential || p.isLocal);
  // Only a model one of the usable providers offers can be sent; anything else would be refused.
  const modelKnown = !!modelId && usable.some(p => p.models.some(m => m.id === modelId));
  const autonomyHint = AUTONOMY.find(a => a.value === autonomy)?.hint ?? "";

  return (
    <footer className={styles.composer}>
      <div className={styles.inputRow}>
        <textarea
          ref={inputRef}
          className={styles.input}
          value={text}
          rows={1}
          placeholder={busy ? "COMU is working…" : "Describe a change, or ask about the code"}
          aria-label="Prompt"
          onChange={event => onText(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              // The same condition as the Send button: Enter must not submit what the button refuses.
              if (!busy && text.trim() && modelKnown) onSubmit();
            }
          }}
        />
        <Button
          variant="primary"
          icon="send"
          label="Send (Enter)"
          disabled={busy || !text.trim() || !modelKnown}
          onClick={onSubmit}
        />
      </div>

      <div className={styles.controls}>
        <label className={styles.control}>
          <span className="comu-visually-hidden">Mode</span>
          <select value={mode} disabled={busy} onChange={event => onMode(event.target.value as TaskMode)} title="How COMU should treat this request">
            {MODES.map(m => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className={`${styles.control} ${styles.autonomy}`} data-level={autonomy}>
          <Icon name={autonomy === "readonly" ? "file" : autonomy === "auto" ? "sync" : "approval"} size={12} />
          <span className="comu-visually-hidden">Autonomy</span>
          <select
            value={autonomy}
            disabled={busy}
            onChange={event => onAutonomy(event.target.value as TaskAutonomy)}
            title={autonomyHint}
          >
            {AUTONOMY.map(a => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>

        <label className={`${styles.control} ${styles.model}`}>
          <span className="comu-visually-hidden">Model</span>
          {/*
            The select only ever shows the model that will be sent. An unset or unrecognised model
            (an old settings value, say) shows as a choice to make, not as the first option in the
            list, which a browser displays while the value underneath is something else.
          */}
          <select value={modelKnown ? modelId : ""} disabled={busy} onChange={event => onModel(event.target.value)} title="Model">
            {usable.length === 0 ? <option value="">No model configured</option> : null}
            {usable.length > 0 && !modelKnown ? (
              <option value="" disabled>
                Choose a model
              </option>
            ) : null}
            {usable.map(provider => (
              <optgroup key={provider.providerId} label={provider.displayName}>
                {provider.models.map(model => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>
    </footer>
  );
}
