import { CommandPlan, CommandResult } from './command_plan';
export interface ProcessManagerOptions {
    timeoutMs?: number;
    maxStdoutBytes?: number;
    maxStderrBytes?: number;
    maxCombinedOutputBytes?: number;
    abortSignal?: AbortSignal;
}
export declare class ProcessManager {
    start(plan: CommandPlan, options?: ProcessManagerOptions): Promise<CommandResult>;
}
//# sourceMappingURL=process_manager.d.ts.map