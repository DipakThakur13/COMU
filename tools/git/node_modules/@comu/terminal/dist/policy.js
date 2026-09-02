"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommandPolicy = void 0;
class CommandPolicy {
    static SAFE_EXECUTABLES = new Set([
        'node', 'npm', 'pnpm', 'yarn',
        'tsc', 'eslint', 'prettier', 'jest', 'mocha', 'vitest',
        'python', 'pytest',
        'go',
        'cargo', 'rustc',
        'java', 'javac', 'mvn', 'gradle'
    ]);
    static DESTRUCTIVE_EXECUTABLES = new Set([
        'rm', 'rmdir', 'del', 'format', 'mkfs', 'dd', 'shutdown', 'reboot'
    ]);
    static NETWORK_EXECUTABLES = new Set([
        'curl', 'wget', 'ssh', 'scp', 'ftp', 'sftp', 'nc', 'ping', 'telnet'
    ]);
    static SHELL_INJECTION_CHARS = /([;&|><$`]|\$\()/;
    evaluate(plan) {
        // 1. Defend against shell injection in executable or args
        if (this.hasShellInjection(plan.executable) || plan.args.some(arg => this.hasShellInjection(arg))) {
            return {
                decision: "DENY",
                category: "RESTRICTED",
                reason: "Command contains shell injection or unapproved shell operators."
            };
        }
        const execBaseWithExt = plan.executable.split(/[/\\]/).pop()?.toLowerCase() || '';
        const execBase = execBaseWithExt.split('.')[0];
        // 2. Protect against inline interpreters
        if (this.isInlineInterpreter(execBase, plan.args)) {
            return {
                decision: "DENY",
                category: "RESTRICTED",
                reason: "Inline interpreter execution (e.g., node -e, python -c) is restricted."
            };
        }
        // 3. Destructive commands
        if (CommandPolicy.DESTRUCTIVE_EXECUTABLES.has(execBase)) {
            return {
                decision: "DENY",
                category: "DESTRUCTIVE",
                reason: `Executable '${execBase}' is categorized as destructive.`
            };
        }
        // 4. Network commands
        if (CommandPolicy.NETWORK_EXECUTABLES.has(execBase)) {
            return {
                decision: "DENY",
                category: "NETWORK",
                reason: `Executable '${execBase}' is categorized as network-capable.`
            };
        }
        // 5. Safe Development commands
        if (CommandPolicy.SAFE_EXECUTABLES.has(execBase)) {
            // Further checks e.g. for npm publish
            if ((execBase === 'npm' || execBase === 'pnpm' || execBase === 'yarn') && plan.args.includes('publish')) {
                return {
                    decision: "DENY",
                    category: "NETWORK",
                    reason: "Package publishing is restricted."
                };
            }
            return {
                decision: "ALLOW",
                category: "SAFE_DEVELOPMENT",
                reason: "Command is an approved development tool."
            };
        }
        // UNKNOWN
        return {
            decision: "DENY",
            category: "UNKNOWN",
            reason: `Executable '${execBase}' is not on the allowed development tools list.`
        };
    }
    hasShellInjection(str) {
        return CommandPolicy.SHELL_INJECTION_CHARS.test(str);
    }
    isInlineInterpreter(exec, args) {
        if (exec === 'node' && (args.includes('-e') || args.includes('--eval')))
            return true;
        if ((exec === 'python' || exec === 'python3') && (args.includes('-c') || args.includes('--command')))
            return true;
        if (exec === 'ruby' && args.includes('-e'))
            return true;
        if (exec === 'php' && args.includes('-r'))
            return true;
        return false;
    }
}
exports.CommandPolicy = CommandPolicy;
//# sourceMappingURL=policy.js.map