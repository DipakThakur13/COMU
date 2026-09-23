import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        // The extension's own root, two levels up from dist/test. It used to be three, which
        // pointed VS Code at apps/ and worked only because VS Code went looking for a manifest
        // inside it; a sibling app acquiring an `engines.vscode` would have broken the suite.
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');
        const extensionTestsPath = path.resolve(__dirname, './suite/index');

        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath
        });
    } catch (err) {
        console.error('Failed to run tests');
        process.exit(1);
    }
}

void main();
