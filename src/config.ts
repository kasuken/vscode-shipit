import * as vscode from 'vscode';
import { ShipItConfig, DEFAULT_CONFIG, ModelSettings, DEFAULT_MODEL_SETTINGS } from './types';

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

/**
 * Get the model settings from VS Code configuration
 */
export function getModelSettings(): ModelSettings {
    const config = vscode.workspace.getConfiguration('shipit');
    
    return {
        prdGeneration: config.get<string>('models.prdGeneration', DEFAULT_MODEL_SETTINGS.prdGeneration),
        userStoriesGeneration: config.get<string>('models.userStoriesGeneration', DEFAULT_MODEL_SETTINGS.userStoriesGeneration),
        taskImplementation: config.get<string>('models.taskImplementation', DEFAULT_MODEL_SETTINGS.taskImplementation)
    };
}

/**
 * Update a model setting in VS Code configuration
 */
export async function updateModelSetting(
    key: keyof ModelSettings, 
    value: string
): Promise<void> {
    const config = vscode.workspace.getConfiguration('shipit');
    await config.update(`models.${key}`, value, vscode.ConfigurationTarget.Global);
}
