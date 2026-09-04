import * as vscode from 'vscode';
import { RuntimeClient } from './runtime_client';

export class HealthMonitor {
    private isConnected: boolean = false;
    private timer: NodeJS.Timeout | null = null;
    
    constructor(
        private client: RuntimeClient,
        private onStatusChanged: (connected: boolean) => void
    ) {}

    public start(intervalMs: number = 5000) {
        this.stop();
        this.check();
        this.timer = setInterval(() => this.check(), intervalMs);
    }

    public stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    public async check() {
        const health = await this.client.health();
        const nowConnected = health.status === 'connected';
        
        if (this.isConnected !== nowConnected) {
            this.isConnected = nowConnected;
            this.onStatusChanged(this.isConnected);
        }
    }

    public getConnected() {
        return this.isConnected;
    }
}
