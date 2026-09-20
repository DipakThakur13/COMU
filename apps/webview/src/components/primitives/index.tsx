import { Component, ErrorInfo, ReactNode, forwardRef } from "react";
import { Icon, IconName } from "./Icon.js";
import styles from "./primitives.module.css";

export { Icon };
export type { IconName };

// ── Button ───────────────────────────────────────────────────────────────────

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: IconName;
  /** Required when the button has no visible text, so it is never an unlabelled control. */
  label?: string;
  small?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", icon, label, small, children, className, ...rest },
  ref
) {
  const iconOnly = !children;
  return (
    <button
      ref={ref}
      type="button"
      className={[styles.button, styles[variant], small ? styles.small : "", iconOnly ? styles.iconOnly : "", className]
        .filter(Boolean)
        .join(" ")}
      aria-label={iconOnly ? label : undefined}
      title={label}
      {...rest}
    >
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
});

// ── StatusPill ───────────────────────────────────────────────────────────────

export type StatusTone = "running" | "ok" | "warn" | "error" | "waiting" | "idle";

const TONE_CLASS: Record<StatusTone, string> = {
  running: styles.pillRunning,
  ok: styles.pillOk,
  warn: styles.pillWarn,
  error: styles.pillError,
  waiting: styles.pillWaiting,
  idle: styles.pillIdle
};

const TONE_ICON: Record<StatusTone, IconName> = {
  running: "sync",
  ok: "check",
  warn: "warning",
  error: "error",
  waiting: "approval",
  idle: "dot"
};

export function StatusPill({ tone, children, spin }: { tone: StatusTone; children: ReactNode; spin?: boolean }) {
  return (
    <span className={`${styles.pill} ${TONE_CLASS[tone]}`}>
      <Icon name={TONE_ICON[tone]} size={11} spin={spin ?? tone === "running"} />
      {children}
    </span>
  );
}

// ── Badge ────────────────────────────────────────────────────────────────────

export function Badge({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className={styles.badge} title={title}>
      {children}
    </span>
  );
}

// ── EmptyState ───────────────────────────────────────────────────────────────

export function EmptyState({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <Icon name={icon} size={20} className={styles.emptyIcon} />
      <p className={styles.emptyTitle}>{title}</p>
      {children ? <p className={styles.emptyBody}>{children}</p> : null}
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

export function Skeleton({ width = "100%", height = 12 }: { width?: number | string; height?: number }) {
  return <div className={styles.skeleton} style={{ width, height }} aria-hidden="true" />;
}

// ── ErrorBoundary ────────────────────────────────────────────────────────────

interface BoundaryProps {
  /** Named so a failure says which region broke rather than blanking the panel. */
  region: string;
  children: ReactNode;
}

interface BoundaryState {
  error?: Error;
}

/**
 * One boundary per major region. A component that throws takes down its own region and says so;
 * the rest of the interface keeps working, which is the property the old interface claimed and
 * could not actually provide.
 */
export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = {};

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[COMU] ${this.props.region} failed to render`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={styles.boundary} role="alert">
        <p className={styles.boundaryTitle}>The {this.props.region} could not be displayed.</p>
        <p className={styles.boundaryDetail}>{this.state.error.message}</p>
        <Button variant="secondary" small onClick={() => this.setState({ error: undefined })}>
          Try again
        </Button>
      </div>
    );
  }
}
