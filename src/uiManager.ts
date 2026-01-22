import { PilotFlowStatusBar, LoopStatus } from './statusBar';
import { TaskCompletion, IPilotFlowUI } from './types';
import { log } from './logger';

/**
 * Manages all UI updates for PilotFlow
 */
export class UIManager {
    private panel: IPilotFlowUI | null = null;
    private sidebarView: IPilotFlowUI | null = null;
    private readonly statusBar: PilotFlowStatusBar;
    private logs: string[] = [];

    constructor(statusBar: PilotFlowStatusBar) {
        this.statusBar = statusBar;
    }

    /**
     * Set the main panel
     */
    setPanel(panel: IPilotFlowUI | null): void {
        this.panel = panel;
    }

    /**
     * Set the sidebar view
     */
    setSidebarView(view: IPilotFlowUI): void {
        this.sidebarView = view;
    }

    /**
     * Update status across all UI components
     */
    updateStatus(status: LoopStatus, iteration: number, currentTask: string): void {
        this.statusBar.setStatus(status);
        this.panel?.updateStatus(status, iteration, currentTask, []);
        this.sidebarView?.updateStatus(status, iteration, currentTask, []);
    }

    /**
     * Set the current iteration
     */
    setIteration(iteration: number): void {
        this.statusBar.setIteration(iteration);
    }

    /**
     * Set the current task info
     */
    setTaskInfo(info: string): void {
        this.statusBar.setTaskInfo(info);
    }

    /**
     * Update countdown display
     */
    updateCountdown(seconds: number): void {
        this.panel?.updateCountdown(seconds);
        this.sidebarView?.updateCountdown(seconds);
    }

    /**
     * Update task history
     */
    updateHistory(history: TaskCompletion[]): void {
        this.panel?.updateHistory(history);
        this.sidebarView?.updateHistory(history);
    }

    /**
     * Update session timing
     */
    updateSessionTiming(startTime: number, taskHistory: TaskCompletion[], pendingTasks: number): void {
        this.panel?.updateSessionTiming(startTime, taskHistory, pendingTasks);
        this.sidebarView?.updateSessionTiming(startTime, taskHistory, pendingTasks);
    }

    /**
     * Update stats display
     */
    async updateStats(): Promise<void> {
        await this.panel?.updateStats();
        this.sidebarView?.updateStats();
    }

    /**
     * Refresh the UI
     */
    async refresh(): Promise<void> {
        await this.panel?.refresh();
        this.sidebarView?.refresh();
    }

    /**
     * Show PRD generating state
     */
    showPrdGenerating(): void {
        this.panel?.showPrdGenerating();
        this.sidebarView?.showPrdGenerating();
    }

    /**
     * Add a log message
     */
    addLog(message: string, highlight: boolean = false): void {
        log(message);
        this.logs.push(message);
        this.panel?.addLog(message, highlight);
        this.sidebarView?.addLog(message, highlight);
    }

    /**
     * Clear all logs
     */
    clearLogs(): void {
        this.logs = [];
        // Clear logs in sidebar if it has this method
        if (this.sidebarView && 'clearLogs' in this.sidebarView) {
            (this.sidebarView as { clearLogs: () => void }).clearLogs();
        }
    }

    /**
     * Get all logs
     */
    getLogs(): string[] {
        return [...this.logs];
    }
}
