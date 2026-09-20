import { spawn, ChildProcess } from 'child_process';
import { CommandPlan, CommandResult } from './command_plan';
import { EnvSanitizer } from './env_sanitizer';
import { buildSpawnTarget } from './executable_resolver';

export interface ProcessManagerOptions {
  timeoutMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  maxCombinedOutputBytes?: number;
  abortSignal?: AbortSignal;
}

export class ProcessManager {
  public async start(plan: CommandPlan, options: ProcessManagerOptions = {}): Promise<CommandResult> {
    const {
      timeoutMs = 30000,
      maxStdoutBytes = 1024 * 1024, // 1MB
      maxStderrBytes = 1024 * 1024, // 1MB
      maxCombinedOutputBytes = 2 * 1024 * 1024,
      abortSignal
    } = options;

    return new Promise((resolve) => {
      let isTimedOut = false;
      let isCancelled = false;
      let stdoutTruncated = false;
      let stderrTruncated = false;
      let combinedOutputTruncated = false;

      let stdoutData = Buffer.alloc(0);
      let stderrData = Buffer.alloc(0);

      const startTime = Date.now();

      const env = EnvSanitizer.sanitize(process.env);

      // Never `shell: true`. The executable is resolved on PATH ourselves, so a real executable is
      // spawned directly with no interpreter. A Windows batch shim (npm, pnpm, tsc, …) cannot be
      // started by CreateProcess, so it goes through `cmd.exe /d /s /c` with the arguments still
      // passed as an argv array for Node to quote; `/d` skips AutoRun, and the policy rejects the
      // `%` and `^` that cmd would otherwise expand or escape.
      const target = buildSpawnTarget(plan.executable, plan.args, env);

      const child: ChildProcess = spawn(target.command, target.args, {
        cwd: plan.cwd,
        env,
        shell: false,
        windowsVerbatimArguments: target.verbatim,
        windowsHide: true,
        detached: process.platform !== 'win32' // Useful for killing process trees on POSIX
      });

      let timeoutId: NodeJS.Timeout | undefined;

      const finish = (code: number | null) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve({
          commandId: Math.random().toString(36).substring(7),
          executable: plan.executable,
          args: plan.args,
          cwd: plan.cwd,
          exitCode: code,
          stdout: stdoutData.toString('utf8'),
          stderr: stderrData.toString('utf8'),
          durationMs: Date.now() - startTime,
          timedOut: isTimedOut,
          cancelled: isCancelled,
          stdoutTruncated,
          stderrTruncated,
          combinedOutputTruncated
        });
      };

      const killProcessTree = () => {
        if (!child.pid) return;
        try {
          if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', child.pid.toString(), '/f', '/t']);
          } else {
            // Negative pid kills the process group
            process.kill(-child.pid, 'SIGTERM');
          }
        } catch (e) {
          // Fallback
          child.kill('SIGKILL');
        }
      };

      if (abortSignal) {
        if (abortSignal.aborted) {
          // Already cancelled before the process could start: stop it immediately.
          isCancelled = true;
          killProcessTree();
        } else {
          abortSignal.addEventListener('abort', () => {
            isCancelled = true;
            killProcessTree();
          }, { once: true });
        }
      }

      if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          isTimedOut = true;
          killProcessTree();
        }, timeoutMs);
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdoutTruncated || combinedOutputTruncated) return;
        
        const newTotalCombined = stdoutData.length + stderrData.length + chunk.length;
        if (newTotalCombined > maxCombinedOutputBytes) {
          combinedOutputTruncated = true;
        }

        if (stdoutData.length + chunk.length > maxStdoutBytes) {
          stdoutTruncated = true;
          const allowedBytes = maxStdoutBytes - stdoutData.length;
          if (allowedBytes > 0) {
             stdoutData = Buffer.concat([stdoutData, chunk.slice(0, allowedBytes)]);
          }
        } else if (!combinedOutputTruncated) {
          stdoutData = Buffer.concat([stdoutData, chunk]);
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderrTruncated || combinedOutputTruncated) return;

        const newTotalCombined = stdoutData.length + stderrData.length + chunk.length;
        if (newTotalCombined > maxCombinedOutputBytes) {
          combinedOutputTruncated = true;
        }

        if (stderrData.length + chunk.length > maxStderrBytes) {
          stderrTruncated = true;
          const allowedBytes = maxStderrBytes - stderrData.length;
          if (allowedBytes > 0) {
             stderrData = Buffer.concat([stderrData, chunk.slice(0, allowedBytes)]);
          }
        } else if (!combinedOutputTruncated) {
          stderrData = Buffer.concat([stderrData, chunk]);
        }
      });

      child.on('error', (err: Error) => {
        stderrData = Buffer.concat([stderrData, Buffer.from(`\nProcess error: ${err.message}`)]);
        finish(null);
      });

      child.on('close', (code) => {
        finish(code);
      });
    });
  }
}
