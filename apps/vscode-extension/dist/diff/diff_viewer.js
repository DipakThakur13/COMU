"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.globalDiffProvider = exports.DiffViewer = void 0;
exports.openDiff = openDiff;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
class DiffViewer {
    client;
    constructor(client) {
        this.client = client;
    }
}
exports.DiffViewer = DiffViewer;
// Global provider instance
class ComuDiffProvider {
    contents = new Map();
    setContent(uri, content) {
        this.contents.set(uri.toString(), content);
    }
    provideTextDocumentContent(uri) {
        return this.contents.get(uri.toString()) || '';
    }
}
exports.globalDiffProvider = new ComuDiffProvider();
async function openDiff(client, taskId, targetPath) {
    try {
        const diffData = await client.getDiff(taskId, targetPath);
        const originalUri = vscode.Uri.parse(`comu-diff:${taskId}/original/${targetPath}`);
        const newUri = vscode.Uri.parse(`comu-diff:${taskId}/modified/${targetPath}`);
        exports.globalDiffProvider.setContent(originalUri, diffData.originalContent || '');
        exports.globalDiffProvider.setContent(newUri, diffData.newContent || '');
        const title = `COMU Diff: ${path.basename(targetPath)}`;
        await vscode.commands.executeCommand('vscode.diff', originalUri, newUri, title);
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to open diff: ${err.message}`);
    }
}
//# sourceMappingURL=diff_viewer.js.map