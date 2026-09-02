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
exports.getWorkspaceContext = getWorkspaceContext;
const vscode = __importStar(require("vscode"));
const crypto_1 = require("crypto");
async function getWorkspaceContext() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return null;
    }
    let targetFolder;
    if (folders.length === 1) {
        targetFolder = folders[0];
    }
    else {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            targetFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
        }
        if (!targetFolder) {
            targetFolder = await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Select workspace folder for COMU' });
        }
    }
    if (!targetFolder) {
        return null;
    }
    const rootPath = targetFolder.uri.fsPath;
    // Deterministic ID based on the selected target folder
    const workspaceId = (0, crypto_1.createHash)('sha256').update(targetFolder.uri.toString()).digest('hex').substring(0, 16);
    return {
        rootPath,
        workspaceId
    };
}
//# sourceMappingURL=workspace_context.js.map