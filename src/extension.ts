import * as vscode from 'vscode';
import { PilotFlowStatusBar } from './statusBar';
import { LoopOrchestrator } from './orchestrator';
import { PilotFlowSidebarProvider } from './sidebarProvider';
import { log, disposeLogger, showLogs } from './logger';
import { getTaskStatsAsync, getNextTaskAsync, initializeProjectAsync } from './fileUtils';

/**
 * Main PilotFlow extension class
 */
class PilotFlowExtension {
    private statusBar: PilotFlowStatusBar;
    private orchestrator: LoopOrchestrator;
    private sidebarProvider: PilotFlowSidebarProvider;

    constructor(private readonly context: vscode.ExtensionContext) {
        log('PilotFlow extension activating...');

        this.statusBar = new PilotFlowStatusBar();
        context.subscriptions.push(this.statusBar);

        this.orchestrator = new LoopOrchestrator(this.statusBar);

        // Create and register sidebar provider
        this.sidebarProvider = new PilotFlowSidebarProvider(context.extensionUri);
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(
                PilotFlowSidebarProvider.viewType,
                this.sidebarProvider
            )
        );

        // Connect sidebar to orchestrator
        this.orchestrator.setSidebarView(this.sidebarProvider);

        this.registerCommands();

        context.subscriptions.push({
            dispose: () => this.dispose()
        });

        log('PilotFlow extension activated');

        // Check for PRD on startup
        this.checkForPrdOnStartup();
    }

    /**
     * Register all commands
     */
    private registerCommands(): void {
        this.context.subscriptions.push(
            vscode.commands.registerCommand('pilotflow.showPanel', () => {
                this.showStatus();
            }),

            vscode.commands.registerCommand('pilotflow.start', () => {
                this.orchestrator.startLoop();
            }),

            vscode.commands.registerCommand('pilotflow.stop', () => {
                this.orchestrator.stopLoop();
            }),

            vscode.commands.registerCommand('pilotflow.pause', () => {
                this.orchestrator.pauseLoop();
            }),

            vscode.commands.registerCommand('pilotflow.resume', () => {
                this.orchestrator.resumeLoop();
            }),

            vscode.commands.registerCommand('pilotflow.next', () => {
                this.orchestrator.runSingleStep();
            }),

            vscode.commands.registerCommand('pilotflow.generatePrd', async () => {
                const description = await vscode.window.showInputBox({
                    prompt: 'Describe what you want to build',
                    placeHolder: 'e.g., A REST API for managing todo items with user authentication'
                });
                if (description) {
                    this.orchestrator.generatePrdFromDescription(description);
                }
            }),

            vscode.commands.registerCommand('pilotflow.viewLogs', () => {
                showLogs();
            }),

            vscode.commands.registerCommand('pilotflow.init', async () => {
                const result = await initializeProjectAsync();
                if (result.success && result.filesCreated.length > 0) {
                    vscode.window.showInformationMessage(
                        `PilotFlow initialized! Created agent files: ${result.filesCreated.join(', ')}`
                    );
                } else if (result.success && result.filesCreated.length === 0) {
                    vscode.window.showInformationMessage(
                        'PilotFlow agents already exist in this project.'
                    );
                } else {
                    vscode.window.showErrorMessage(
                        `PilotFlow initialization failed: ${result.errors.join(', ')}`
                    );
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
            ? `PilotFlow: ${stats.completed}/${stats.total} tasks complete. ${nextTask ? `Next: ${nextTask.description}` : 'All done!'}`
            : 'PilotFlow: No PRD found. Generate one or create PRD.md manually.';

        const action = await vscode.window.showInformationMessage(message, ...actions);

        switch (action) {
            case 'Start':
                this.orchestrator.startLoop();
                break;
            case 'Stop':
                this.orchestrator.stopLoop();
                break;
            case 'Generate PRD':
                vscode.commands.executeCommand('pilotflow.generatePrd');
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
                `PilotFlow found ${stats.pending} pending task(s) in your PRD. Start executing?`,
                'Start PilotFlow',
                'Later'
            );

            if (action === 'Start PilotFlow') {
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

let extensionInstance: PilotFlowExtension | null = null;

export function activate(context: vscode.ExtensionContext): void {
    extensionInstance = new PilotFlowExtension(context);
}

export function deactivate(): void {
    log('PilotFlow extension deactivating...');
    extensionInstance?.dispose();
    extensionInstance = null;
}

