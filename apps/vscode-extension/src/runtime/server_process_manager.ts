import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { randomBytes } from 'crypto';
import { RuntimeClient } from './runtime_client';

export class ServerProcessManager {
    private childProcess?: child_process.ChildProcess;
    private outputChannel?: vscode.OutputChannel;
    private readonly runtimeToken: string;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly runtimeClient: RuntimeClient
    ) {
        // One random token per extension session. COMU_RUNTIME_TOKEN lets a developer run the
        // runtime standalone with a known token and still connect from the extension.
        this.runtimeToken = (process.env.COMU_RUNTIME_TOKEN || '').trim() || randomBytes(32).toString('hex');
        this.runtimeClient.setAuthToken(this.runtimeToken);
    }

    public async ensureServerRunning(): Promise<boolean> {
        // 1. Check if server is already running and healthy (e.g. standalone instance started with our token)
        const initialHealth = await this.runtimeClient.health();
        if (initialHealth.status === 'connected') {
            return true;
        }
        if (initialHealth.details === 'unauthorized') {
            if (!this.outputChannel) {
                this.outputChannel = vscode.window.createOutputChannel('COMU Agent Runtime');
            }
            this.outputChannel.appendLine("[COMU] A COMU runtime is already listening at the configured base URL but does not accept this session's token. Stop it, start it with the same COMU_RUNTIME_TOKEN, or change comu.runtime.baseUrl.");
            return false;
        }

        // 2. Resolve bundled server script path
        const bundledPath = path.join(this.extensionUri.fsPath, 'server', 'index.js');
        const fallbackMonorepoPath = path.resolve(this.extensionUri.fsPath, '..', 'agent-runtime', 'dist', 'server.js');
        
        let serverScript = '';
        if (fs.existsSync(bundledPath)) {
            serverScript = bundledPath;
        } else if (fs.existsSync(fallbackMonorepoPath)) {
            serverScript = fallbackMonorepoPath;
        }

        if (!serverScript) {
            console.warn('[COMU ServerManager] Bundled server script not found at', bundledPath);
            return false;
        }

        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel('COMU Agent Runtime');
        }
        this.outputChannel.appendLine(`[COMU] Starting Agent Runtime backend from ${serverScript}...`);

        try {
            // Spawn node process using VS Code's Electron binary with ELECTRON_RUN_AS_NODE: "1"
            const env = {
                ...process.env,
                PORT: String(this.resolvePort()),
                COMU_RUNTIME_TOKEN: this.runtimeToken,
                ELECTRON_RUN_AS_NODE: '1'
            };

            this.childProcess = child_process.spawn(process.execPath, [serverScript], {
                env,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            this.childProcess.stdout?.on('data', (data) => {
                const text = data.toString();
                this.outputChannel?.append(text);
            });

            this.childProcess.stderr?.on('data', (data) => {
                const text = data.toString();
                this.outputChannel?.append(text);
            });

            this.childProcess.on('exit', (code, signal) => {
                this.outputChannel?.appendLine(`[COMU Runtime process stopped (code ${code}, signal ${signal})]`);
                this.childProcess = undefined;
            });

            // Poll health check for up to 6 seconds
            const startTime = Date.now();
            while (Date.now() - startTime < 6000) {
                await new Promise(r => setTimeout(r, 400));
                const health = await this.runtimeClient.health();
                if (health.status === 'connected') {
                    this.outputChannel.appendLine(`[COMU] Agent Runtime connected on http://127.0.0.1:${this.resolvePort()} (loopback only, token authenticated)`);
                    return true;
                }
            }

            return false;
        } catch (err: any) {
            this.outputChannel.appendLine(`[COMU] Failed to start Agent Runtime: ${err.message}`);
            return false;
        }
    }

    private resolvePort(): number {
        const configured = vscode.workspace.getConfiguration('comu').get<string>('runtime.baseUrl');
        try {
            const port = configured ? Number(new URL(configured).port) : NaN;
            if (Number.isFinite(port) && port > 0) return port;
        } catch {
            // fall through to default
        }
        return 3456;
    }

    public stopServer() {
        if (this.childProcess) {
            try {
                this.childProcess.kill();
            } catch {}
            this.childProcess = undefined;
        }
    }
}
