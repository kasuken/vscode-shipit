import * as vscode from 'vscode';

export type CopilotResult = 'agent' | 'chat' | 'clipboard';

export interface CopilotOptions {
    freshChat: boolean;
}

/**
 * Try to execute a VS Code command
 * @returns true if command succeeded, false otherwise
 */
async function tryCommand(command: string, args?: unknown): Promise<boolean> {
    try {
        await vscode.commands.executeCommand(command, args);
        return true;
    } catch {
        return false;
    }
}

/**
 * Open Copilot with a prompt
 * Tries agent mode first, then chat, then clipboard fallback
 */
export async function openCopilotWithPrompt(
    prompt: string,
    options: CopilotOptions = { freshChat: false }
): Promise<CopilotResult> {
    // Start fresh session if requested
    if (options.freshChat) {
        await tryCommand('workbench.action.chat.newEditSession');
    }

    // Try agent mode (Edit Session)
    if (await tryCommand('workbench.action.chat.openEditSession', { query: prompt })) {
        return 'agent';
    }

    // Try regular chat
    if (await tryCommand('workbench.action.chat.open', { query: prompt })) {
        return 'chat';
    }

    // Fallback: copy to clipboard
    await vscode.env.clipboard.writeText(prompt);
    vscode.window.showInformationMessage('PilotFlow: Prompt copied to clipboard. Paste in Copilot Chat.');
    return 'clipboard';
}

/**
 * Start a fresh chat session
 */
export async function startFreshChatSession(): Promise<boolean> {
    return tryCommand('workbench.action.chat.newEditSession');
}
