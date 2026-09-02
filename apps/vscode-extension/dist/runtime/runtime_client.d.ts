import { TaskRequest } from '@comu/protocol';
export interface HealthStatus {
    status: 'connected' | 'disconnected' | 'starting';
    details?: string;
}
export interface TaskInfo {
    taskId: string;
    status: string;
}
export declare class RuntimeClient {
    private get baseUrl();
    getHeaders(): Promise<Record<string, string>>;
    health(): Promise<HealthStatus>;
    createTask(request: TaskRequest): Promise<TaskInfo>;
    cancelTask(taskId: string): Promise<void>;
    getEventStreamUrl(taskId: string): string;
    pushConfig(providers: any): Promise<void>;
    getDiff(taskId: string, path: string): Promise<{
        originalContent?: string;
        newContent?: string;
        error?: string;
    }>;
}
//# sourceMappingURL=runtime_client.d.ts.map