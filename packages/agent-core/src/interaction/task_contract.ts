import { InteractionMode } from "./interaction_modes.js";
import { AgentLimits } from "@comu/protocol";
import { ToolCapability } from "@comu/tool-core";

export interface WorkspaceScope {
  rootPath?: string;
  workspaceId?: string;
  allowedDirectories?: string[];
  allowedFiles?: string[];
}

export interface TaskContract {
  taskId: string;
  runId: string;

  mode: InteractionMode;

  goal: string;

  expectedMutation: boolean;

  allowedCapabilities: ToolCapability[];

  workspaceScope: WorkspaceScope;

  allowedTools: string[];

  verificationRequired: boolean;

  limits: AgentLimits;

  createdAt: string;

  source: "user" | "follow_up" | "system";
}

/**
 * Validates whether a proposed tool and capability usage matches the task contract.
 */
export function validateTaskContract(
  contract: TaskContract,
  toolName: string,
  requiredCapabilities: ToolCapability[]
): { valid: boolean; reason?: string } {
  // Check capabilities
  for (const cap of requiredCapabilities) {
    if (!contract.allowedCapabilities.includes(cap)) {
      return {
        valid: false,
        reason: `Capability '${cap}' is forbidden in ${contract.mode} mode.`,
      };
    }
  }

  // Check specific tool constraints if defined
  if (contract.allowedTools.length > 0) {
    if (!contract.allowedTools.includes(toolName)) {
      return {
        valid: false,
        reason: `Tool '${toolName}' is not allowed by the current task contract.`,
      };
    }
  }

  // Additional rules per mode
  if (contract.mode === "CHAT") {
    return {
      valid: false,
      reason: "No tools can be executed in CHAT mode.",
    };
  }
  
  if (contract.mode === "ASK" || contract.mode === "PLAN") {
    if (requiredCapabilities.includes("write") || requiredCapabilities.includes("execute")) {
      return {
        valid: false,
        reason: `Write/Execute tools are forbidden in ${contract.mode} mode.`,
      };
    }
  }

  return { valid: true };
}
