import type { RuntimeClient } from './runtime_client';

/** May be async: the extension pushes provider config to the runtime when it comes up. */
export type HealthStatusListener = (connected: boolean) => void | Promise<void>;

export class HealthMonitor {
    private isConnected: boolean = false;
    private initialChecked: boolean = false;
    private checking: boolean = false;
    private timer: NodeJS.Timeout | null = null;

    constructor(
        private client: Pick<RuntimeClient, 'health'>,
        private onStatusChanged: HealthStatusListener,
        private log: (message: string) => void = (message) => console.warn(message)
    ) {}

    public start(intervalMs: number = 5000) {
        this.stop();
        void this.check();
        this.timer = setInterval(() => { void this.check(); }, intervalMs);
    }

    public stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /**
     * One health probe. Never rejects: a failing probe or a throwing listener is logged so the
     * periodic timer keeps running instead of producing an unhandled rejection.
     */
    public async check(): Promise<void> {
        if (this.checking) return; // a slow probe must not pile up overlapping checks
        this.checking = true;
        try {
            const health = await this.client.health();
            const nowConnected = health.status === 'connected';

            if (!this.initialChecked || this.isConnected !== nowConnected) {
                this.initialChecked = true;
                this.isConnected = nowConnected;
                await this.onStatusChanged(this.isConnected);
            }
        } catch (err) {
            this.log(`[COMU HealthMonitor] check failed: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            this.checking = false;
        }
    }

    public getConnected() {
        return this.isConnected;
    }
}
