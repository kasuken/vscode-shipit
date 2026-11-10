import { defineConfig } from '@vscode/test-cli';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workspaceFolder = mkdtempSync(join(tmpdir(), 'shipit-tests-'));
process.on('exit', () => rmSync(workspaceFolder, { recursive: true, force: true }));

export default defineConfig({
	files: 'out/test/**/*.test.js',
	workspaceFolder,
	useInstallation: process.env.VSCODE_EXECUTABLE_PATH
		? { fromPath: process.env.VSCODE_EXECUTABLE_PATH }
		: undefined,
	mocha: { timeout: 10000, failZero: true },
});
