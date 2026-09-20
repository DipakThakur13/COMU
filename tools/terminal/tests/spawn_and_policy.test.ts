import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { CommandPolicy } from "../src/policy";
import { CommandPlan } from "../src/command_plan";
import { buildSpawnTarget, isBatchFile, quoteForCmd, resolveExecutable } from "../src/executable_resolver";
import { ProcessManager } from "../src/process_manager";

function plan(executable: string, args: string[], source: CommandPlan["source"] = "AGENT"): CommandPlan {
  return { executable, args, cwd: process.cwd(), source };
}

const policy = new CommandPolicy();

describe("CommandPolicy: git by subcommand", () => {
  it("allows read-only git for anyone, including a model-originated terminal call", () => {
    for (const sub of ["status", "diff", "log", "show", "rev-parse", "ls-files", "blame"]) {
      const decision = policy.evaluate(plan("git", [sub]));
      expect(decision.decision, `git ${sub}`).toBe("ALLOW");
      expect(decision.category).toBe("OBSERVABILITY");
    }
  });

  it("refuses mutating git from the terminal, so the approval gate cannot be side-stepped", () => {
    for (const sub of ["add", "commit", "push", "checkout", "switch", "branch"]) {
      const decision = policy.evaluate(plan("git", [sub], "AGENT"));
      expect(decision.decision, `git ${sub} from AGENT`).toBe("DENY");
      expect(decision.reason).toMatch(/governed git tools/);
    }
  });

  it("allows the same subcommands for the governed git tools", () => {
    for (const sub of ["add", "commit", "push", "checkout", "branch"]) {
      expect(policy.evaluate(plan("git", [sub], "GIT")).decision, `git ${sub} from GIT`).toBe("ALLOW");
    }
  });

  it("permanently forbids destructive and history-rewriting git, from every source", () => {
    const forbidden: Array<[string, string[]]> = [
      ["reset --hard", ["reset", "--hard", "HEAD~1"]],
      ["clean -fd", ["clean", "-fd"]],
      ["clean --force", ["clean", "--force"]],
      ["checkout --force", ["checkout", "--force", "main"]],
      ["switch -f", ["switch", "-f", "main"]],
      ["push --force", ["push", "--force", "origin", "main"]],
      ["push --force-with-lease", ["push", "--force-with-lease"]],
      ["push --delete", ["push", "--delete", "origin", "branch"]],
      ["branch -D", ["branch", "-D", "old"]],
      ["branch -M", ["branch", "-M", "main"]],
      ["tag -d", ["tag", "-d", "v1"]],
      ["rebase", ["rebase", "main"]],
      ["filter-branch", ["filter-branch", "--all"]],
      ["reflog", ["reflog", "expire"]],
      ["gc", ["gc", "--prune=now"]],
      ["update-ref", ["update-ref", "-d", "refs/heads/x"]],
      ["config", ["config", "user.email", "x@y.z"]],
      ["pull", ["pull"]],
      ["merge", ["merge", "main"]],
      ["cherry-pick", ["cherry-pick", "abc"]],
      ["submodule", ["submodule", "update"]],
      ["stash drop", ["stash", "drop"]]
    ];
    for (const [label, args] of forbidden) {
      for (const source of ["AGENT", "GIT"] as const) {
        const decision = policy.evaluate(plan("git", args, source));
        expect(decision.decision, `${label} from ${source}`).toBe("DENY");
      }
    }
  });

  it("refuses bare git and unknown subcommands", () => {
    expect(policy.evaluate(plan("git", [])).decision).toBe("DENY");
    expect(policy.evaluate(plan("git", ["bisect"])).decision).toBe("DENY");
  });
});

describe("CommandPolicy: Windows expansion characters", () => {
  it("rejects percent and caret, which cmd would expand or escape", () => {
    expect(policy.evaluate(plan("npm", ["run", "%PATH%"])).decision).toBe("DENY");
    expect(policy.evaluate(plan("npm", ["run", "build^"])).decision).toBe("DENY");
    expect(policy.evaluate(plan("npm", ["run", "%USERPROFILE%\\x"])).decision).toBe("DENY");
  });

  it("still allows ordinary development arguments", () => {
    expect(policy.evaluate(plan("npm", ["run", "test:integration", "--", "--runInBand"])).decision).toBe("ALLOW");
    expect(policy.evaluate(plan("pytest", ["tests/", "-k", "auth"])).decision).toBe("ALLOW");
  });
});

describe("Executable resolution", () => {
  it("recognises Windows batch shims", () => {
    expect(isBatchFile("C:\\tools\\npm.cmd")).toBe(true);
    expect(isBatchFile("C:\\tools\\thing.BAT")).toBe(true);
    expect(isBatchFile("/usr/bin/node")).toBe(false);
    expect(isBatchFile("C:\\tools\\node.exe")).toBe(false);
  });

  it("resolves a real executable on PATH and spawns it with no interpreter", () => {
    const resolved = resolveExecutable("node");
    expect(resolved.kind).toBe("executable");
    expect(path.isAbsolute(resolved.file)).toBe(true);

    const target = buildSpawnTarget("node", ["--version"]);
    expect(target.viaCmd).toBe(false);
    expect(target.verbatim).toBe(false);
    expect(target.args).toEqual(["--version"]);
  });

  it("reports an unresolvable name rather than throwing, so the OS error surfaces", () => {
    const resolved = resolveExecutable("definitely-not-a-real-command-xyz");
    expect(resolved.kind).toBe("unresolved");
    expect(resolved.file).toBe("definitely-not-a-real-command-xyz");
  });

  it("quotes arguments for cmd, including paths with spaces and embedded quotes", () => {
    expect(quoteForCmd("plain")).toBe('"plain"');
    expect(quoteForCmd("C:\\Program Files\\nodejs\\npm.cmd")).toBe('"C:\\Program Files\\nodejs\\npm.cmd"');
    expect(quoteForCmd('say "hi"')).toBe('"say \\"hi\\""');
    // A trailing backslash must be doubled or it would escape the closing quote.
    expect(quoteForCmd("C:\\dir\\")).toBe('"C:\\dir\\\\"');
  });

  it("routes a batch shim through cmd with the whole line quoted verbatim", () => {
    const env = { ...process.env, PATH: "", ComSpec: "C:\\Windows\\System32\\cmd.exe" };
    const target = buildSpawnTarget("C:\\Program Files\\nodejs\\npm.cmd", ["run", "build"], env);
    expect(target.viaCmd).toBe(true);
    expect(target.verbatim).toBe(true);
    expect(target.command).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(target.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    // cmd /s strips exactly the outer pair, leaving the quoted path intact.
    expect(target.args[3]).toBe('""C:\\Program Files\\nodejs\\npm.cmd" "run" "build""');
  });
});

describe("ProcessManager", () => {
  it("runs a real executable without a shell", async () => {
    const result = await new ProcessManager().start(plan("node", ["--version"]), { timeoutMs: 15_000 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^v\d+\./);
    expect(result.cancelled).toBe(false);
  });

  it("reports cancellation when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await new ProcessManager().start(plan("node", ["-e", "setTimeout(()=>{},5000)"]), {
      timeoutMs: 15_000,
      abortSignal: controller.signal
    });
    expect(result.cancelled).toBe(true);
  });

  it("kills a running process when the signal aborts mid-flight", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = new ProcessManager().start(
      plan("node", ["-e", "setTimeout(() => process.exit(0), 20000)"]),
      { timeoutMs: 30_000, abortSignal: controller.signal }
    );
    setTimeout(() => controller.abort(), 150);
    const result = await pending;
    expect(result.cancelled).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 20_000);
});
