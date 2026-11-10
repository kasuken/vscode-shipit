import * as vscode from 'vscode';
import { ShipItStatusBar } from './statusBar';
import { LoopOrchestrator } from './orchestrator';
import { ShipItSidebarProvider } from './sidebarProvider';
import { log, disposeLogger, showLogs } from './logger';
import { getTaskStatsAsync, createManualPrdAsync, readProjectDescriptionAsync, createOrOpenProjectDescriptionAsync } from './fileUtils';

/**
 * Main ShipIt extension class
 */
class ShipItExtension {
    private statusBar: ShipItStatusBar;
    private orchestrator: LoopOrchestrator;
    private sidebarProvider: ShipItSidebarProvider;
    private disposing: Promise<void> | undefined;

    constructor(private readonly context: vscode.ExtensionContext) {
        log('ShipIt extension activating...');

        this.statusBar = new ShipItStatusBar();
        context.subscriptions.push(this.statusBar);

        this.orchestrator = new LoopOrchestrator(this.statusBar);

        // Create and register sidebar provider
        this.sidebarProvider = new ShipItSidebarProvider(context.extensionUri);
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(
                ShipItSidebarProvider.viewType,
                this.sidebarProvider
            )
        );

        // Connect sidebar to orchestrator
        this.orchestrator.setSidebarView(this.sidebarProvider);

        this.registerCommands();

        context.subscriptions.push({
            dispose: () => this.dispose()
        });

        log('ShipIt extension activated');

        // Check for PRD on startup
        this.checkForPrdOnStartup();
    }

    /**
     * Register all commands
     */
    private registerCommands(): void {
        this.context.subscriptions.push(
            vscode.commands.registerCommand('shipit.showPanel', () => {
                return vscode.commands.executeCommand('shipit.sidebar.focus');
            }),

            vscode.commands.registerCommand('shipit.start', () => {
                return this.orchestrator.startLoop();
            }),

            vscode.commands.registerCommand('shipit.stop', () => {
                return this.orchestrator.stopLoop();
            }),

            vscode.commands.registerCommand('shipit.pause', () => {
                this.orchestrator.pauseLoop();
            }),

            vscode.commands.registerCommand('shipit.resume', () => {
                this.orchestrator.resumeLoop();
            }),

            vscode.commands.registerCommand('shipit.next', () => {
                return this.orchestrator.runSingleStep();
            }),

            vscode.commands.registerCommand('shipit.generatePrd', async () => {
                // Check if project description file exists and has content
                const existingDescription = await readProjectDescriptionAsync();
                
                if (existingDescription) {
                    // File exists with content - generate PRD from it
                    vscode.window.showInformationMessage('Starting PRD generation from your project description...');
                    await this.orchestrator.generatePrdFromDescription(existingDescription);
                } else {
                    // File doesn't exist or is empty - create/open it for editing
                    const created = await createOrOpenProjectDescriptionAsync();
                    if (created) {
                        vscode.window.showInformationMessage(
                            'Write your project description in the file, save it, and click "Generate PRD" again.',
                            'Got it'
                        );
                    }
                }
            }),

            vscode.commands.registerCommand('shipit.generateUserStories', async (taskDescription?: string) => {
                if (!taskDescription) {
                    vscode.window.showErrorMessage('ShipIt: No task specified');
                    return;
                }
                await this.orchestrator.generateUserStoriesForTask(taskDescription);
            }),

            vscode.commands.registerCommand('shipit.generateAllUserStories', async () => {
                await this.orchestrator.generateAllUserStories();
            }),

            vscode.commands.registerCommand('shipit.viewLogs', () => {
                showLogs();
            }),

            vscode.commands.registerCommand('shipit.createManualPrd', async () => {
                const result = await createManualPrdAsync();
                if (result) {
                    await this.sidebarProvider.refresh();
                }
            })
        );
    }

    /**
     * Check for PRD on startup and notify user
     */
    private async checkForPrdOnStartup(): Promise<void> {
        const stats = await getTaskStatsAsync();

        if (stats.total > 0 && stats.pending > 0) {
            const action = await vscode.window.showInformationMessage(
                `ShipIt found ${stats.pending} pending task(s) in your PRD. Start executing?`,
                'Start ShipIt',
                'Later'
            );

            if (action === 'Start ShipIt') {
                this.orchestrator.startLoop();
            }
        }
    }

    /**
     * Dispose resources
     */
    dispose(): Promise<void> {
        this.disposing ??= this.orchestrator.dispose().finally(disposeLogger);
        return this.disposing;
    }
}

let extensionInstance: ShipItExtension | null = null;

export function activate(context: vscode.ExtensionContext): void {
    extensionInstance = new ShipItExtension(context);
}

export async function deactivate(): Promise<void> {
    log('ShipIt extension deactivating...');
    await extensionInstance?.dispose();
    extensionInstance = null;
}

