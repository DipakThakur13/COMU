import { RuntimeClient } from './runtime_client';
export declare class HealthMonitor {
    private client;
    private onStatusChanged;
    private isConnected;
    private timer;
    constructor(client: RuntimeClient, onStatusChanged: (connected: boolean) => void);
    start(intervalMs?: number): void;
    stop(): void;
    check(): Promise<void>;
    getConnected(): boolean;
}
//# sourceMappingURL=health_monitor.d.ts.map