import { CommandPlan, CommandDecision } from './command_plan';
export declare class CommandPolicy {
    private static readonly SAFE_EXECUTABLES;
    private static readonly DESTRUCTIVE_EXECUTABLES;
    private static readonly NETWORK_EXECUTABLES;
    private static readonly SHELL_INJECTION_CHARS;
    evaluate(plan: CommandPlan): CommandDecision;
    private hasShellInjection;
    private isInlineInterpreter;
}
//# sourceMappingURL=policy.d.ts.map