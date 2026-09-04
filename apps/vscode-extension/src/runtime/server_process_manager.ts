import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { RuntimeClient } from './runtime_client';

export class ServerProcessManager {
    private childProcess?: child_process.ChildProcess;
    private outputChannel?: vscode.OutputChannel;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly runtimeClient: RuntimeClient
    ) {}

    public async ensureServerRunning(): Promise<boolean> {
        // 1. Check if server is already running and healthy (e.g. standalone instance)
        const initialHealth = await this.runtimeClient.health();
        if (initialHealth.status === 'connected') {
            return true;
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
                PORT: '3456',
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
                    this.outputChannel.appendLine('[COMU] Agent Runtime connected successfully on http://localhost:3456');
                    return true;
                }
            }

            return false;
        } catch (err: any) {
            this.outputChannel.appendLine(`[COMU] Failed to start Agent Runtime: ${err.message}`);
            return false;
        }
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
