import * as vscode from 'vscode';

export type CopilotResult = 'agent' | 'chat' | 'clipboard';

export interface CopilotOptions {
    freshChat: boolean;
}

export async function openCopilotWithPrompt(
    prompt: string,
    options: CopilotOptions = { freshChat: false }
): Promise<CopilotResult> {
    const tryCommand = async (command: string, args?: unknown): Promise<boolean> => {
        try {
            await vscode.commands.executeCommand(command, args);
            return true;
        } catch {
            return false;
        }
    };

    if (options.freshChat) {
        await tryCommand('workbench.action.chat.newEditSession');
    }

    if (await tryCommand('workbench.action.chat.openEditSession', { query: prompt })) {
        return 'agent';
    }

    if (await tryCommand('workbench.action.chat.open', { query: prompt })) {
        return 'chat';
    }

    await vscode.env.clipboard.writeText(prompt);
    vscode.window.showInformationMessage('PilotFlow: Prompt copied to clipboard. Paste in Copilot Chat.');
    return 'clipboard';
}
