export interface CanonicalToolCall {
  id: string;
  name: string;
  arguments: any;
}

export type ToolCallParseError =
  | "MISSING_NAME"
  | "MISSING_ARGUMENTS"
  | "INVALID_ARGUMENTS_TYPE"
  | "UNKNOWN_STRUCTURE"
  | "MISSING_ID";

export type ToolParseResult =
  | {
      type: "text";
      content: string;
    }
  | {
      type: "tool_call";
      call: CanonicalToolCall;
    }
  | {
      type: "malformed_tool_call";
      error: ToolCallParseError;
      raw: any;
    };

export class CanonicalToolCallParser {
  /**
   * Parses and validates a potential tool call.
   * If the input is just text or natural language describing a tool, it returns type "text".
   * If the input is a structurally valid CanonicalToolCall, it returns type "tool_call".
   * If the input is meant to be a tool call but is structurally deficient, it returns type "malformed_tool_call".
   */
  public parse(input: any): ToolParseResult {
    // If input is just a string, it's plain text. It can never be an executable tool call.
    if (typeof input === "string") {
      return { type: "text", content: input };
    }

    if (!input || typeof input !== "object") {
      return { type: "text", content: String(input) };
    }

    // Heuristic: Does this object look like it's claiming to be a tool call?
    // Providers typically map structured output to an object with 'id', 'name', 'arguments'.
    const hasName = "name" in input && typeof input.name === "string" && input.name.trim() !== "";
    const hasId = "id" in input && typeof input.id === "string" && input.id.trim() !== "";
    const hasArgs = "arguments" in input;

    // If it lacks all defining characteristics of our structured ToolCall, treat it as unknown/text structure
    if (!hasName && !hasId && !hasArgs) {
      return { type: "text", content: JSON.stringify(input) };
    }

    // Now we know it's *intended* to be a tool call. Let's strictly validate it.
    if (!hasName) {
      return { type: "malformed_tool_call", error: "MISSING_NAME", raw: input };
    }

    if (!hasId) {
      return { type: "malformed_tool_call", error: "MISSING_ID", raw: input };
    }

    if (!hasArgs) {
      return { type: "malformed_tool_call", error: "MISSING_ARGUMENTS", raw: input };
    }

    if (typeof input.arguments !== "object" || input.arguments === null || Array.isArray(input.arguments)) {
      return { type: "malformed_tool_call", error: "INVALID_ARGUMENTS_TYPE", raw: input };
    }

    // It passes strict structural validation.
    return {
      type: "tool_call",
      call: {
        id: input.id,
        name: input.name,
        arguments: input.arguments,
      },
    };
  }
}
