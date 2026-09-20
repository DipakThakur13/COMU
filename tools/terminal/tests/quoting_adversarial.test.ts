import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CommandPolicy } from "../src/policy";
import type { CommandPlan } from "../src/command_plan";
import { buildSpawnTarget, quoteForCmd } from "../src/executable_resolver";
import { ProcessManager } from "../src/process_manager";

/**
 * Adversarial quoting for the cmd.exe path.
 *
 * A Windows batch shim (npm.cmd, pnpm.cmd, tsc.cmd, …) cannot be started by CreateProcess, so it
 * goes through `cmd.exe /d /s /c`. That is the single place in COMU where a command line is parsed
 * by something other than us, and cmd's rules are not the rules anyone expects. So every argument
 * shape that could change meaning in transit must either be refused by the policy or arrive at the
 * child byte for byte. Silent corruption is the one outcome that is not allowed: an argument that
 * half-survives is how a build flag turns into a different build flag.
 *
 * The end-to-end block below does not reason about cmd's parser, it asks a real child process what
 * it actually received. That distinction matters here: an earlier version of this investigation
 * "found" four defects that were entirely artefacts of the test harness losing a backslash.
 */

const policy = new CommandPolicy();

function plan(args: string[], executable = "npm"): CommandPlan {
  return { executable, args, cwd: process.cwd(), source: "AGENT" };
}

/** Values the policy must reject outright, because cmd would reinterpret them. */
const REFUSED: Array<[string, string]> = [
  ["percent expansion", "%USERPROFILE%"],
  ["percent, bare pair", "%PATH%"],
  ["percent, single", "50%"],
  ["caret escape", "build^"],
  ["caret before a metacharacter", "a^&b"],
  ["command separator", "a;b"],
  ["chain/background", "a&b"],
  ["pipe", "a|b"],
  ["output redirect", "a>b"],
  ["input redirect", "a<b"],
  ["backtick substitution", "`whoami`"],
  ["dollar substitution", "$(whoami)"],
  ["bare dollar", "$HOME"],
];

/**
 * Values the policy allows, which therefore have to survive the cmd path unchanged.
 *
 * Quotes and backslashes are the interesting ones: cmd strips the outer pair, and the child's C
 * runtime then applies its own backslash-before-quote rule. The two have to agree.
 */
const LITERAL: Array<[string, string]> = [
  ["a space", "hello world"],
  ["parentheses", "fn(arg)"],
  ["parentheses around a space", "my (test) name"],
  ["embedded double quotes", 'say "hi"'],
  ["an argument that is itself quoted", '"quoted"'],
  ["a trailing backslash", "C:\\dir\\"],
  ["two trailing backslashes", "C:\\dir\\\\"],
  ["a backslash before a quote", 'C:\\dir\\"x'],
  ["interior backslashes", "a\\b\\c"],
  ["a lone backslash", "\\"],
  ["a quote then a backslash", '"\\'],
  ["a single quote", "it's"],
  ["equals and comma", "--define=A,B"],
  ["square brackets", "tests[0]"],
  ["an at sign", "@scope/pkg"],
  ["an exclamation mark", "important!"],
  ["a hash", "issue#42"],
  ["an empty argument", ""],
];

describe("The policy refuses what cmd would reinterpret", () => {
  for (const [label, value] of REFUSED) {
    it(`refuses ${label} in an argument`, () => {
      const decision = policy.evaluate(plan(["run", value]));
      expect(decision.decision, `${label}: ${value}`).toBe("DENY");
      expect(decision.category).toBe("RESTRICTED");
    });

    it(`refuses ${label} in the executable name`, () => {
      expect(policy.evaluate(plan([], `npm${value}`)).decision, `${label}: ${value}`).toBe("DENY");
    });
  }

  it("refuses them at any position in the argument vector, not just the first", () => {
    expect(policy.evaluate(plan(["run", "build", "--out", "%TEMP%\\x"])).decision).toBe("DENY");
    expect(policy.evaluate(plan(["run", "build", "--out", "x", "&&", "evil"])).decision).toBe("DENY");
  });

  it("allows every value that the literal cases below rely on", () => {
    for (const [label, value] of LITERAL) {
      expect(policy.evaluate(plan(["run", value])).decision, `${label}: ${value}`).toBe("ALLOW");
    }
  });
});

describe("quoteForCmd produces a token cmd cannot misread", () => {
  /**
   * Reverses the escaping the way a C runtime does, so a round-trip proves the encoding is
   * lossless rather than merely plausible.
   */
  function decodeAsChildWould(quoted: string): string {
    expect(quoted.startsWith('"') && quoted.endsWith('"') && quoted.length >= 2).toBe(true);
    const inner = quoted.slice(1, -1);
    let out = "";
    let slashes = 0;
    for (const ch of inner) {
      if (ch === "\\") {
        slashes++;
        continue;
      }
      if (ch === '"') {
        // Backslashes before a quote are halved, and the quote itself was escaped by one of them.
        out += "\\".repeat(slashes >> 1) + '"';
        slashes = 0;
        continue;
      }
      out += "\\".repeat(slashes) + ch;
      slashes = 0;
    }
    // A run at the very end was doubled so it cannot escape the closing quote.
    return out + "\\".repeat(slashes >> 1);
  }

  for (const [label, value] of LITERAL) {
    it(`round-trips ${label}`, () => {
      expect(decodeAsChildWould(quoteForCmd(value)), `${label}: ${JSON.stringify(value)}`).toBe(value);
    });
  }

  it("leaves no unescaped quote that would end the token early", () => {
    for (const [label, value] of LITERAL) {
      const inner = quoteForCmd(value).slice(1, -1);
      expect([...inner.matchAll(/(?<!\\)"/g)], `${label}: ${quoteForCmd(value)}`).toHaveLength(0);
    }
  });

  it("leaves an even run of backslashes before the closing quote, which cannot escape it", () => {
    for (const [label, value] of LITERAL) {
      const quoted = quoteForCmd(value);
      const trailing = /(\\*)$/.exec(quoted.slice(0, -1))?.[1] ?? "";
      expect(trailing.length % 2, `${label}: ${quoted}`).toBe(0);
    }
  });

  it("always yields a single token, so one argument can never become two", () => {
    for (const [label, value] of LITERAL) {
      const quoted = quoteForCmd(value);
      expect(quoted.startsWith('"'), label).toBe(true);
      expect(quoted.endsWith('"'), label).toBe(true);
      // Any space is inside the quoted span, never at the boundary where it would split.
      expect(quoted.slice(1, -1).includes('" "'), label).toBe(false);
    }
  });
});

describe("The assembled cmd invocation", () => {
  let dir: string;
  let shim: string;
  const env = (): NodeJS.ProcessEnv => ({ PATH: "", ComSpec: "C:\\Windows\\System32\\cmd.exe" });

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "comu-quote-"));
    shim = path.join(dir, "my shim.cmd");
    fs.writeFileSync(shim, "@echo off\r\n");
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("routes a batch shim through cmd and quotes the shim path and every argument", () => {
    const target = buildSpawnTarget(shim, ["run", "my (test)", 'say "hi"'], env());
    expect(target.viaCmd).toBe(true);
    expect(target.verbatim).toBe(true);
    expect(target.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(target.args[3]).toBe(`"${quoteForCmd(shim)} "run" "my (test)" "say \\"hi\\"""`);
  });

  it("wraps the whole line in the one outer pair that /s strips", () => {
    const line = buildSpawnTarget(shim, ["run"], env()).args[3];
    expect(line.startsWith('""')).toBe(true);
    expect(line.endsWith('""')).toBe(true);
  });

  it("passes /d, so a machine-wide AutoRun command cannot be injected into the shell", () => {
    expect(buildSpawnTarget(shim, [], env()).args).toContain("/d");
  });

  it("names cmd by ComSpec rather than by a bare name PATH could redirect", () => {
    expect(buildSpawnTarget(shim, [], env()).command).toBe("C:\\Windows\\System32\\cmd.exe");
  });

  it("keeps a real executable off the cmd path entirely", () => {
    const target = buildSpawnTarget(process.execPath, ["-v"], env());
    expect(target.viaCmd).toBe(false);
    expect(target.verbatim).toBe(false);
    expect(target.args).toEqual(["-v"]);
  });

  it("preserves an empty argument as an empty argument rather than dropping it", () => {
    expect(buildSpawnTarget(shim, ["run", "", "after"], env()).args[3]).toContain('"run" "" "after"');
  });
});

/**
 * The part that cannot be argued with: spawn a real batch shim through the real cmd.exe and ask the
 * child what it received.
 */
describe.skipIf(process.platform !== "win32")("What the child process actually receives", () => {
  let dir: string;
  let shim: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "comu-quote-e2e-"));
    // A space in the directory name, because that is the case that broke before: every default
    // Node install on Windows lives under "C:\Program Files\nodejs".
    const inner = path.join(dir, "with space");
    fs.mkdirSync(inner);
    fs.writeFileSync(path.join(inner, "echo_argv.js"), "console.log(JSON.stringify(process.argv.slice(2)));\n");
    shim = path.join(inner, "echoargs.cmd");
    // Forwards its arguments the way npm.cmd and every other shim does.
    fs.writeFileSync(shim, '@echo off\r\nnode "%~dp0echo_argv.js" %*\r\n');
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  async function received(args: string[]): Promise<string[]> {
    const result = await new ProcessManager().start(
      { executable: shim, args, cwd: dir, source: "AGENT" },
      { timeoutMs: 30_000 }
    );
    expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);
    return JSON.parse(result.stdout.trim()) as string[];
  }

  for (const [label, value] of LITERAL) {
    it(`delivers ${label} unchanged`, async () => {
      expect(await received([value])).toEqual([value]);
    }, 35_000);
  }

  it("delivers a whole vector of awkward arguments in order and unchanged", async () => {
    const args = ["run", "build", "--out", "my (dir)", 'say "hi"', "C:\\dir\\", "--define=A,B", ""];
    expect(await received(args)).toEqual(args);
  }, 35_000);

  it("expands %VAR% if one ever reaches cmd, which is why the policy refuses it", async () => {
    // Not a wish, a measurement. The quoting cannot defend against this, so the policy has to, and
    // this test fails the day someone relaxes that rule believing the quoting covers it.
    const got = await received(["%PATH%"]);
    expect(got[0]).not.toBe("%PATH%");
    expect(policy.evaluate(plan(["run", "%PATH%"])).decision).toBe("DENY");
  }, 35_000);
});
