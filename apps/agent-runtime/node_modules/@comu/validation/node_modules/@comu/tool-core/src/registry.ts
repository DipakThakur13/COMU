import { AgentTool } from "./interfaces.js";
import { ToolError } from "@comu/shared";

export class ToolRegistry {
  private tools = new Map<string, AgentTool>();

  register(tool: AgentTool) {
    if (this.tools.has(tool.name)) {
      throw new ToolError(`Tool ${tool.name} is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): AgentTool {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new ToolError(`Tool ${name} not found`);
    }
    return tool;
  }

  getAll(): AgentTool[] {
    return Array.from(this.tools.values());
  }
}
