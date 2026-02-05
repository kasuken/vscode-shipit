import * as vscode from 'vscode';
import { ShipItStatusBar } from './statusBar';
import { LoopOrchestrator } from './orchestrator';
import { ShipItSidebarProvider } from './sidebarProvider';
import { log, disposeLogger, showLogs } from './logger';
import { getTaskStatsAsync, getNextTaskAsync, createManualPrdAsync, readProjectDescriptionAsync, createOrOpenProjectDescriptionAsync } from './fileUtils';

/**
 * Main ShipIt extension class
 */
class ShipItExtension {
    private statusBar: ShipItStatusBar;
    private orchestrator: LoopOrchestrator;
    private sidebarProvider: ShipItSidebarProvider;

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
                this.showStatus();
            }),

            vscode.commands.registerCommand('shipit.start', () => {
                this.orchestrator.startLoop();
            }),

            vscode.commands.registerCommand('shipit.stop', () => {
                this.orchestrator.stopLoop();
            }),

            vscode.commands.registerCommand('shipit.pause', () => {
                this.orchestrator.pauseLoop();
            }),

            vscode.commands.registerCommand('shipit.resume', () => {
                this.orchestrator.resumeLoop();
            }),

            vscode.commands.registerCommand('shipit.next', () => {
                this.orchestrator.runSingleStep();
            }),

            vscode.commands.registerCommand('shipit.generatePrd', async () => {
                // Check if project description file exists and has content
                const existingDescription = await readProjectDescriptionAsync();
                
                if (existingDescription) {
                    // File exists with content - generate PRD from it
                    vscode.window.showInformationMessage('Starting PRD generation from your project description...');
                    this.orchestrator.generatePrdFromDescription(existingDescription);
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
     * Show status information
     */
    private async showStatus(): Promise<void> {
        const stats = await getTaskStatsAsync();
        const nextTask = await getNextTaskAsync();

        const actions: string[] = ['Start', 'Stop', 'Generate PRD', 'View Logs'];

        const message = stats.total > 0
            ? `ShipIt: ${stats.completed}/${stats.total} tasks complete. ${nextTask ? `Next: ${nextTask.description}` : 'All done!'}`
            : 'ShipIt: No PRD found. Generate one or create PRD.md manually.';

        const action = await vscode.window.showInformationMessage(message, ...actions);

        switch (action) {
            case 'Start':
                this.orchestrator.startLoop();
                break;
            case 'Stop':
                this.orchestrator.stopLoop();
                break;
            case 'Generate PRD':
                vscode.commands.executeCommand('shipit.generatePrd');
                break;
            case 'View Logs':
                showLogs();
                break;
        }
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
    dispose(): void {
        this.orchestrator.dispose();
        disposeLogger();
    }
}

let extensionInstance: ShipItExtension | null = null;

export function activate(context: vscode.ExtensionContext): void {
    extensionInstance = new ShipItExtension(context);
}

export function deactivate(): void {
    log('ShipIt extension deactivating...');
    extensionInstance?.dispose();
    extensionInstance = null;
}

