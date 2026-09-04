import * as vscode from 'vscode';
import { TaskRequest } from '@comu/protocol';
import { SecretManager } from '../security/secrets';

export interface HealthStatus {
    status: 'connected' | 'disconnected' | 'starting';
    details?: string;
}

export interface TaskInfo {
    taskId: string;
    status: string;
}

export class RuntimeClient {
    private get baseUrl(): string {
        const config = vscode.workspace.getConfiguration('comu');
        return config.get<string>('runtime.baseUrl') || 'http://localhost:3456';
    }

    public async getHeaders(): Promise<Record<string, string>> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        const apiKey = await SecretManager.getInstance().getProviderKey('nvidia');
        if (apiKey) {
            headers['X-NVIDIA-API-KEY'] = apiKey;
        }
        return headers;
    }

    public async health(): Promise<HealthStatus> {
        try {
            const res = await fetch(`${this.baseUrl}/v1/health`);
            if (res.ok) {
                return { status: 'connected' };
            }
            return { status: 'disconnected', details: `Status ${res.status}` };
        } catch (error: any) {
            return { status: 'disconnected', details: error.message };
        }
    }

    public async createTask(request: TaskRequest): Promise<TaskInfo> {
        const res = await fetch(`${this.baseUrl}/v1/tasks`, {
            method: 'POST',
            headers: await this.getHeaders(),
            body: JSON.stringify(request)
        });

        if (!res.ok) {
            const err = await res.text().catch(() => 'Unknown error');
            throw new Error(`Failed to create task: ${res.status} ${err}`);
        }

        const data = await res.json() as any;
        return { taskId: data.taskId, status: data.status };
    }

    public async cancelTask(taskId: string): Promise<void> {
        const res = await fetch(`${this.baseUrl}/v1/tasks/${taskId}/cancel`, {
            method: 'POST',
            headers: await this.getHeaders()
        });

        if (!res.ok) {
            throw new Error(`Failed to cancel task: ${res.status}`);
        }
    }

    public getEventStreamUrl(taskId: string): string {
        return `${this.baseUrl}/v1/tasks/${taskId}/events`;
    }

    public async pushConfig(providers: any): Promise<void> {
        const res = await fetch(`${this.baseUrl}/v1/config/providers`, {
            method: 'POST',
            headers: await this.getHeaders(),
            body: JSON.stringify({ providers })
        });
        if (!res.ok) {
            console.error('Failed to push config to runtime');
        }
    }

    public async getDiff(taskId: string, path: string): Promise<{ originalContent?: string; newContent?: string; error?: string }> {
        const res = await fetch(`${this.baseUrl}/v1/tasks/${taskId}/diff?path=${encodeURIComponent(path)}`, {
            headers: await this.getHeaders()
        });
        
        if (!res.ok) {
            throw new Error(`Failed to get diff: ${res.status}`);
        }
        
        return await res.json() as any;
    }

    public async respondInteraction(taskId: string, interactionId: string, response: any): Promise<void> {
        const res = await fetch(`${this.baseUrl}/v1/tasks/${taskId}/interactions/${interactionId}/respond`, {
            method: 'POST',
            headers: await this.getHeaders(),
            body: JSON.stringify({ response })
        });

        if (!res.ok) {
            const err = await res.text().catch(() => 'Unknown error');
            throw new Error(`Failed to respond to interaction: ${res.status} ${err}`);
        }
    }
}
