import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | null = null;

/**
 * Get or create the PilotFlow output channel
 */
export function getLogger(): vscode.OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('PilotFlow');
    }
    return outputChannel;
}

/**
 * Log a message to the output channel
 */
export function log(message: string): void {
    const timestamp = new Date().toISOString();
    getLogger().appendLine(`[${timestamp}] ${message}`);
}

/**
 * Log an error to the output channel
 */
export function logError(message: string, error?: unknown): void {
    const timestamp = new Date().toISOString();
    const errorStr = error instanceof Error ? error.message : String(error || '');
    getLogger().appendLine(`[${timestamp}] ❌ ERROR: ${message} ${errorStr}`);
}

/**
 * Show the output channel
 */
export function showLogs(): void {
    getLogger().show();
}

/**
 * Dispose the output channel
 */
export function disposeLogger(): void {
    outputChannel?.dispose();
    outputChannel = null;
}
