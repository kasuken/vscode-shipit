import * as vscode from 'vscode';
import { ShipItConfig, DEFAULT_CONFIG } from './types';

/**
 * Get the current ShipIt configuration from VS Code settings
 */
export function getConfig(): ShipItConfig {
    const config = vscode.workspace.getConfiguration('shipit');

    return {
        files: {
            prdPath: config.get<string>('files.prdPath', DEFAULT_CONFIG.files.prdPath),
            progressPath: config.get<string>('files.progressPath', DEFAULT_CONFIG.files.progressPath)
        },
        prompt: {
            customTemplate: config.get<string>('prompt.customTemplate', DEFAULT_CONFIG.prompt.customTemplate),
            customPrdGenerationTemplate: config.get<string>('prompt.customPrdGenerationTemplate', DEFAULT_CONFIG.prompt.customPrdGenerationTemplate)
        }
    };
}
