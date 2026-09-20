import type { ProviderConfig, ProviderTestResult } from "@comu/protocol";
import { Button, EmptyState } from "../primitives/index.js";
import { ProviderCard } from "./ProviderCard.js";
import styles from "./settings.module.css";

export interface SettingsViewProps {
  providers: ProviderConfig[];
  testResults: Record<string, ProviderTestResult>;
  testing: string | undefined;
  /** Provider the host deep-linked to, if any. */
  target?: string;
  onClose: () => void;
  onSave: (providerId: string, key: string, endpoint?: string) => void;
  onRemove: (providerId: string) => void;
  onTest: (providerId: string, key?: string, endpoint?: string) => void;
}

/**
 * Provider settings.
 *
 * Ready providers come first, because the common visit is "which model can I use right now".
 */
export function SettingsView({ providers, testResults, testing, target, onClose, onSave, onRemove, onTest }: SettingsViewProps) {
  const ready = providers.filter(p => p.hasCredential || p.isLocal);
  const rest = providers.filter(p => !(p.hasCredential || p.isLocal));

  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <h2 className={styles.title}>Providers</h2>
        <Button variant="ghost" small icon="close" label="Close settings" onClick={onClose} />
      </header>

      <p className={styles.intro}>
        COMU does not resell inference. Connect your own provider, or run a model locally. Keys are
        held in the operating system keychain.
      </p>

      <div className={styles.list}>
        {providers.length === 0 ? (
          <EmptyState icon="settings" title="No providers available">
            The runtime has not reported a provider catalogue yet.
          </EmptyState>
        ) : null}

        {[...ready, ...rest].map(provider => (
          <ProviderCard
            key={provider.providerId}
            provider={provider}
            testResult={testResults[provider.providerId]}
            testing={testing === provider.providerId}
            highlighted={target === provider.providerId}
            onSave={(key, endpoint) => onSave(provider.providerId, key, endpoint)}
            onRemove={() => onRemove(provider.providerId)}
            onTest={(key, endpoint) => onTest(provider.providerId, key, endpoint)}
          />
        ))}
      </div>
    </div>
  );
}
