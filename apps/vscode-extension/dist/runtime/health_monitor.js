"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthMonitor = void 0;
class HealthMonitor {
    client;
    onStatusChanged;
    isConnected = false;
    timer = null;
    constructor(client, onStatusChanged) {
        this.client = client;
        this.onStatusChanged = onStatusChanged;
    }
    start(intervalMs = 5000) {
        this.stop();
        this.check();
        this.timer = setInterval(() => this.check(), intervalMs);
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    async check() {
        const health = await this.client.health();
        const nowConnected = health.status === 'connected';
        if (this.isConnected !== nowConnected) {
            this.isConnected = nowConnected;
            this.onStatusChanged(this.isConnected);
        }
    }
    getConnected() {
        return this.isConnected;
    }
}
exports.HealthMonitor = HealthMonitor;
//# sourceMappingURL=health_monitor.js.map