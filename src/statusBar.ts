import * as vscode from 'vscode';

export type LoopStatus = 'idle' | 'running' | 'paused' | 'waiting';

/**
 * PilotFlow status bar item
 */
export class PilotFlowStatusBar implements vscode.Disposable {
    private statusItem: vscode.StatusBarItem;
    private status: LoopStatus = 'idle';
    private taskInfo: string = '';
    private iteration: number = 0;

    constructor() {
        this.statusItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.statusItem.command = 'pilotflow.showPanel';
        this.update();
        this.statusItem.show();
    }

    /**
     * Set the current status
     */
    setStatus(status: LoopStatus): void {
        this.status = status;
        this.update();
    }

    /**
     * Set the current task info
     */
    setTaskInfo(info: string): void {
        this.taskInfo = info;
        this.update();
    }

    /**
     * Set the current iteration number
     */
    setIteration(n: number): void {
        this.iteration = n;
        this.update();
    }

    /**
     * Update the status bar display
     */
    private update(): void {
        let icon: string;
        let text: string;
        let tooltip: string;

        switch (this.status) {
            case 'running':
                icon = '$(sync~spin)';
                text = `PilotFlow: Running #${this.iteration}`;
                tooltip = `Working on: ${this.taskInfo || 'Starting...'}\nClick to open control panel`;
                break;
            case 'paused':
                icon = '$(debug-pause)';
                text = 'PilotFlow: Paused';
                tooltip = 'Loop paused. Click to open control panel';
                break;
            case 'waiting':
                icon = '$(watch)';
                text = 'PilotFlow: Waiting';
                tooltip = `Waiting for Copilot to complete task\nTask: ${this.taskInfo}\nClick to open control panel`;
                break;
            default:
                icon = '$(rocket)';
                text = 'PilotFlow';
                tooltip = 'Click to open PilotFlow control panel';
        }

        this.statusItem.text = `${icon} ${text}`;
        this.statusItem.tooltip = tooltip;

        this.statusItem.backgroundColor = this.status === 'running'
            ? new vscode.ThemeColor('statusBarItem.warningBackground')
            : undefined;
    }

    /**
     * Dispose the status bar item
     */
    dispose(): void {
        this.statusItem.dispose();
    }
}
