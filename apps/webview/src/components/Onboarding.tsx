import type { ProviderConfig } from "@comu/protocol";
import { Button, Icon } from "./primitives/index.js";
import styles from "./onboarding.module.css";

/**
 * Four things worth asking for, as a starting point rather than a menu.
 *
 * Each fills the composer and leaves the cursor there. None of them submits: the point is to show
 * the shape of a useful request, and a prompt that runs itself teaches nothing and surprises the
 * user on their first click.
 */
const SUGGESTIONS: Array<{ label: string; prompt: string }> = [
  { label: "Fix the failing tests", prompt: "Fix the failing tests in this repository." },
  { label: "Explain this codebase", prompt: "Analyse this codebase and explain its architecture and entry points." },
  { label: "Review recent changes", prompt: "Review the changes on this branch and tell me what looks risky." },
  { label: "Add verification", prompt: "Add automated verification for the core services in this repository." }
];

export interface OnboardingProps {
  providers: ProviderConfig[];
  onSuggest: (prompt: string) => void;
  onOpenSettings: () => void;
}

/**
 * The first thing anyone sees.
 *
 * Two jobs, in priority order: get a provider connected, because nothing works without one, and
 * show what COMU is for. Once a provider is usable the setup card steps out of the way rather
 * than staying as permanent furniture.
 */
export function Onboarding({ providers, onSuggest, onOpenSettings }: OnboardingProps) {
  // A local provider needs no key, but it does need to be running. Counting an unreachable daemon
  // as ready is the same mistake as listing a cloud provider that no key could ever reach.
  const usable = providers.filter(p => (p.isLocal ? p.status === "CONNECTED" : p.hasCredential));
  const local = providers.find(p => p.isLocal);
  const needsSetup = providers.length > 0 && usable.length === 0;

  return (
    <div className={styles.wrap}>
      <div className={styles.hero}>
        <Icon name="agent" size={22} className={styles.heroIcon} />
        <h2 className={styles.title}>COMU</h2>
        <p className={styles.subtitle}>
          Describe a change. COMU plans it, makes it, and verifies it, asking before it writes.
        </p>
      </div>

      {needsSetup ? (
        <section className={styles.setup}>
          <h3 className={styles.setupTitle}>Connect a model first</h3>
          <p className={styles.setupBody}>
            COMU does not resell inference, so it needs your own provider. Keys are held in the
            operating system keychain, never in this panel and never in the repository.
          </p>
          <div className={styles.setupActions}>
            <Button variant="primary" small icon="settings" onClick={onOpenSettings}>
              Connect a provider
            </Button>
            {local ? (
              <Button variant="secondary" small onClick={onOpenSettings}>
                Use {local.displayName}
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className={styles.suggestions}>
        <h3 className={styles.suggestionsTitle}>Try asking for</h3>
        <ul className={styles.chips}>
          {SUGGESTIONS.map(suggestion => (
            <li key={suggestion.label}>
              <button
                type="button"
                className={styles.chip}
                title={suggestion.prompt}
                onClick={() => onSuggest(suggestion.prompt)}
              >
                {suggestion.label}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
