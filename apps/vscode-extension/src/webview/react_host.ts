import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';

interface ViteManifestEntry {
    file: string;
    css?: string[];
    isEntry?: boolean;
}

/**
 * Builds the host document for the React webview.
 *
 * Generated in TypeScript rather than read from disk and string-replaced, which is what lets the
 * policy be strict: the bundle is a real file with a per-load nonce, so `script-src` needs neither
 * `unsafe-inline` nor a wildcard, and `connect-src` can be dropped entirely because the webview
 * talks to the extension host through postMessage and never opens a socket of its own.
 */
export function buildReactWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = randomBytes(16).toString('base64');
    const distRoot = path.join(extensionUri.fsPath, 'dist', 'webview');
    const assets = resolveAssets(distRoot);

    if (!assets) {
        return buildMissingBundleHtml();
    }

    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', assets.script));
    const styleTags = assets.styles
        .map(href => {
            const uri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', href));
            return `    <link rel="stylesheet" href="${uri}">`;
        })
        .join('\n');

    const csp = [
        `default-src 'none'`,
        `img-src ${webview.cspSource} data:`,
        `style-src ${webview.cspSource}`,
        `font-src ${webview.cspSource}`,
        `script-src 'nonce-${nonce}'`
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>COMU</title>
${styleTags}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}

/** Reads Vite's manifest to find the hashed entry bundle and its stylesheets. */
function resolveAssets(distRoot: string): { script: string; styles: string[] } | undefined {
    const manifestPath = path.join(distRoot, '.vite', 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        return undefined;
    }
    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, ViteManifestEntry>;
        const entry = Object.values(manifest).find(e => e.isEntry) ?? manifest['src/main.tsx'];
        if (!entry?.file) return undefined;
        return { script: entry.file, styles: entry.css ?? [] };
    } catch {
        return undefined;
    }
}

/**
 * Shown when the bundle is absent, which means the build step did not run. Says exactly that
 * rather than rendering an empty panel that looks like a product failure.
 */
function buildMissingBundleHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="UTF-8"><title>COMU</title></head>
  <body style="padding:16px;font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);">
    <h3 style="color:var(--vscode-errorForeground);margin-top:0;">The COMU interface bundle is missing</h3>
    <p>The experimental interface is enabled but <code>dist/webview</code> has not been built.</p>
    <p>Run <code>pnpm --filter @comu/webview build</code>, or turn off <code>comu.ui.experimental</code> to use the current interface.</p>
  </body>
</html>`;
}
