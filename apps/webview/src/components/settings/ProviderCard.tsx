import { useEffect, useState } from "react";
import type { ProviderConfig, ProviderTestResult } from "@comu/protocol";
import { Button, Icon, StatusPill, StatusTone } from "../primitives/index.js";
import styles from "./settings.module.css";

function toneFor(status: ProviderConfig["status"]): { tone: StatusTone; label: string } {
  switch (status) {
    case "CONNECTED":
      return { tone: "ok", label: "Connected" };
    case "CONNECTING":
      return { tone: "running", label: "Checking" };
    case "INVALID_CREDENTIAL":
      return { tone: "error", label: "Key rejected" };
    case "CONNECTION_ERROR":
      return { tone: "error", label: "Unreachable" };
    case "TIMEOUT":
      return { tone: "warn", label: "Timed out" };
    case "DISABLED":
      return { tone: "idle", label: "Disabled" };
    default:
      return { tone: "idle", label: "No key yet" };
  }
}

export interface ProviderCardProps {
  provider: ProviderConfig;
  testResult?: ProviderTestResult;
  testing: boolean;
  onSave: (key: string, endpoint?: string) => void;
  onRemove: () => void;
  onTest: (key?: string, endpoint?: string) => void;
}

/**
 * One provider.
 *
 * The old cards broke "OpenAI-Compatible" across two lines mid-word, wrapped the status tag inside
 * itself, and split "GPT-6 Astra (Experiential Labs)" awkwardly, because the layout was never
 * tested at the width it actually runs at. Names wrap only on word boundaries, tags never wrap,
 * and the endpoint, which is the one genuinely unbreakable string, is the only thing allowed to
 * break anywhere.
 */
export function ProviderCard({ provider, testResult, testing, onSave, onRemove, onTest }: ProviderCardProps) {
  const [key, setKey] = useState("");
  const [endpoint, setEndpoint] = useState(provider.endpoint ?? "");

  useEffect(() => setEndpoint(provider.endpoint ?? ""), [provider.endpoint]);

  const { tone, label } = toneFor(provider.status);
  const local = provider.isLocal === true;
  const keyId = `provider-key-${provider.providerId}`;
  const endpointId = `provider-endpoint-${provider.providerId}`;

  return (
    <section className={styles.card} aria-labelledby={`provider-name-${provider.providerId}`}>
      <div className={styles.cardHead}>
        <h3 className={styles.name} id={`provider-name-${provider.providerId}`}>
          {provider.displayName}
        </h3>
        <StatusPill tone={tone}>{label}</StatusPill>
      </div>

      <p className={styles.tags}>
        <span className={styles.tag}>{local ? "Local" : "Cloud"}</span>
        {local ? <span className={styles.tag}>No key needed</span> : null}
        {provider.environmentDetected ? <span className={styles.tag}>From environment</span> : null}
      </p>

      {provider.description ? <p className={styles.description}>{provider.description}</p> : null}

      {provider.models.length > 0 ? (
        <ul className={styles.models}>
          {provider.models.slice(0, 4).map(model => (
            <li key={model.id} className={styles.model}>
              <span className={styles.modelName}>{model.name}</span>
              {model.contextTokens ? (
                <span className={styles.modelMeta}>{Math.round(model.contextTokens / 1000)}k context</span>
              ) : null}
            </li>
          ))}
          {provider.models.length > 4 ? (
            <li className={styles.modelMore}>and {provider.models.length - 4} more</li>
          ) : null}
        </ul>
      ) : null}

      {local ? (
        <div className={styles.field}>
          <label htmlFor={endpointId}>Daemon address</label>
          <input id={endpointId} type="text" value={endpoint} readOnly className={styles.readOnlyInput} />
          <p className={styles.fieldHint}>Change this with the comu.ollama.endpoint setting.</p>
        </div>
      ) : (
        <>
          <div className={styles.field}>
            <label htmlFor={keyId}>API key</label>
            <input
              id={keyId}
              type="password"
              value={key}
              autoComplete="off"
              spellCheck={false}
              placeholder={provider.hasCredential ? "A key is saved. Enter a new one to replace it." : "Paste your key"}
              onChange={event => setKey(event.target.value)}
            />
            <p className={styles.fieldHint}>
              Stored in the operating system keychain through VS Code, never in this panel and never in the repository.
            </p>
          </div>

          <div className={styles.field}>
            <label htmlFor={endpointId}>Endpoint</label>
            <input
              id={endpointId}
              type="text"
              value={endpoint}
              spellCheck={false}
              onChange={event => setEndpoint(event.target.value)}
            />
          </div>
        </>
      )}

      {testResult ? (
        <p className={testResult.status === "CONNECTED" ? styles.testOk : styles.testFail} role="status">
          <Icon name={testResult.status === "CONNECTED" ? "check" : "error"} size={12} />
          {testResult.status === "CONNECTED"
            ? `Reachable${testResult.latencyMs ? ` in ${testResult.latencyMs}ms` : ""}${testResult.model ? ` · ${testResult.model}` : ""}`
            : testResult.message || "Could not connect."}
        </p>
      ) : null}

      <div className={styles.actions}>
        {!local ? (
          <Button variant="primary" small icon="check" disabled={!key.trim()} onClick={() => onSave(key.trim(), endpoint.trim() || undefined)}>
            Save
          </Button>
        ) : null}
        <Button variant="secondary" small icon="sync" disabled={testing} onClick={() => onTest(key.trim() || undefined, endpoint.trim() || undefined)}>
          {testing ? "Testing…" : "Test connection"}
        </Button>
        {!local && provider.hasCredential ? (
          <Button variant="danger" small icon="close" onClick={onRemove}>
            Remove key
          </Button>
        ) : null}
      </div>
    </section>
  );
}
