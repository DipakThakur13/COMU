"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RuntimeClient = void 0;
const vscode = __importStar(require("vscode"));
const secrets_1 = require("../security/secrets");
class RuntimeClient {
    get baseUrl() {
        const config = vscode.workspace.getConfiguration('comu');
        return config.get('runtime.baseUrl') || 'http://localhost:3456';
    }
    async getHeaders() {
        const headers = {
            'Content-Type': 'application/json'
        };
        const apiKey = await secrets_1.SecretManager.getInstance().getProviderKey('nvidia');
        if (apiKey) {
            headers['X-NVIDIA-API-KEY'] = apiKey;
        }
        return headers;
    }
    async health() {
        try {
            const res = await fetch(`${this.baseUrl}/v1/health`);
            if (res.ok) {
                return { status: 'connected' };
            }
            return { status: 'disconnected', details: `Status ${res.status}` };
        }
        catch (error) {
            return { status: 'disconnected', details: error.message };
        }
    }
    async createTask(request) {
        const res = await fetch(`${this.baseUrl}/v1/tasks`, {
            method: 'POST',
            headers: await this.getHeaders(),
            body: JSON.stringify(request)
        });
        if (!res.ok) {
            const err = await res.text().catch(() => 'Unknown error');
            throw new Error(`Failed to create task: ${res.status} ${err}`);
        }
        const data = await res.json();
        return { taskId: data.taskId, status: data.status };
    }
    async cancelTask(taskId) {
        const res = await fetch(`${this.baseUrl}/v1/tasks/${taskId}/cancel`, {
            method: 'POST',
            headers: await this.getHeaders()
        });
        if (!res.ok) {
            throw new Error(`Failed to cancel task: ${res.status}`);
        }
    }
    getEventStreamUrl(taskId) {
        return `${this.baseUrl}/v1/tasks/${taskId}/events`;
    }
    async pushConfig(providers) {
        const res = await fetch(`${this.baseUrl}/v1/config/providers`, {
            method: 'POST',
            headers: await this.getHeaders(),
            body: JSON.stringify({ providers })
        });
        if (!res.ok) {
            console.error('Failed to push config to runtime');
        }
    }
    async getDiff(taskId, path) {
        const res = await fetch(`${this.baseUrl}/v1/tasks/${taskId}/diff?path=${encodeURIComponent(path)}`, {
            headers: await this.getHeaders()
        });
        if (!res.ok) {
            throw new Error(`Failed to get diff: ${res.status}`);
        }
        return await res.json();
    }
}
exports.RuntimeClient = RuntimeClient;
//# sourceMappingURL=runtime_client.js.map