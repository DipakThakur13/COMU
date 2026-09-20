import fs from "node:fs";
import path from "node:path";
import type { ModelProvider, ModelRequest, ModelResponse } from "@comu/model-core";

/**
 * A stand-in model for exercising the harness without a provider key.
 *
 * It is not an agent and makes no decisions. It reads the fixture's golden solution and issues the
 * tool calls that would apply it, one file per turn, then stops. That makes the whole instrument
 * observable end to end: fixtures materialise, tools run, approvals are requested and answered,
 * events are folded into metrics, and the graders reach a verdict on a workspace that really did
 * change.
 *
 * Reading the golden solution is legitimate here and only here, because this measures the harness.
 * Nothing it learns reaches a real run: the benchmark refuses to write a result file when this
 * model is in use, and the pristine-workspace assertion still runs before every task.
 */
export class SelfTestModel implements ModelProvider {
  id = "selftest-model";
  name = "Self test model";

  private queue: Array<{ path: string; content: string }> = [];
  private started = false;

  /** Set to true to exercise the failure path: the model does nothing and reports success. */
  constructor(
    private readonly goldenDir: string,
    private readonly behaviour: "apply" | "claim-without-doing" | "answer" = "apply",
    private readonly answer = ""
  ) {}

  getCapabilities() {
    return {
      toolCalling: true,
      streaming: false,
      reasoning: false,
      vision: false,
      structuredOutput: true,
      maxContextTokens: 128_000
    };
  }

  private load(): void {
    if (this.started) return;
    this.started = true;
    if (this.behaviour !== "apply" || !fs.existsSync(this.goldenDir)) return;

    const walk = (dir: string, prefix: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, rel);
        else this.queue.push({ path: rel, content: fs.readFileSync(full, "utf8") });
      }
    };
    walk(this.goldenDir, "");
  }

  async generate(_request: ModelRequest): Promise<ModelResponse> {
    this.load();

    if (this.behaviour === "answer") {
      return { text: this.answer };
    }

    const next = this.queue.shift();
    if (!next) {
      return { text: "Applied the change." };
    }

    return {
      text: `Writing ${next.path}.`,
      toolCalls: [
        {
          id: `selftest-${this.queue.length}-${next.path.replace(/[^a-zA-Z0-9]/g, "-")}`,
          name: "write_file",
          arguments: { path: next.path, content: next.content }
        }
      ]
    };
  }
}
