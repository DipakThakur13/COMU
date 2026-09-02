import { AgentTool, ToolCapability, ToolContext } from '@comu/tool-core';
import { ValidationResult } from './types';
declare class BaseValidationTool implements AgentTool<any, ValidationResult> {
    name: string;
    description: string;
    capabilities: ToolCapability[];
    inputSchema: {
        type: string;
        properties: {};
    };
    private target;
    private processManager;
    private policy;
    constructor(name: string, description: string, target: "test" | "build" | "lint" | "typecheck");
    execute(args: any, context: ToolContext): Promise<ValidationResult>;
    private createResult;
}
export declare class RunTestsTool extends BaseValidationTool {
    constructor();
}
export declare class RunBuildTool extends BaseValidationTool {
    constructor();
}
export declare class RunLinterTool extends BaseValidationTool {
    constructor();
}
export declare class RunTypecheckTool extends BaseValidationTool {
    constructor();
}
export {};
//# sourceMappingURL=validation_tools.d.ts.map