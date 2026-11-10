import * as vscode from 'vscode';
import { IShipItUI, REVIEW_COUNTDOWN_SECONDS, ShipItSettings, Task, TaskRequirements, TaskStatus } from './types';
import { logError } from './logger';
import {
    appendProgressAsync, ensureProgressFileAsync, getAllTasksAsync, getNextUserStoryAsync,
    getTaskStatsAsync, getUserStoryStatsAsync, getWorkspaceRoot, hasUserStoriesForTaskAsync,
    markTaskCompleteAsync
} from './fileUtils';
import { ShipItStatusBar } from './statusBar';
import { CountdownTimer, formatDuration, InactivityMonitor } from './timerManager';
import { ActivityWatcher } from './fileWatchers';
import { UIManager } from './uiManager';
import { TaskRunner } from './taskRunner';

export class LoopOrchestrator {
    private readonly ui: UIManager;
    private readonly taskRunner = new TaskRunner();
    private readonly countdownTimer = new CountdownTimer();
    private readonly inactivityMonitor = new InactivityMonitor();
    private readonly activityWatcher = new ActivityWatcher();
    private operation: Promise<void> | null = null;
    private stopped = true;
    private paused = false;
    private resumeWaiter: (() => void) | null = null;
    private sessionStartTime = 0;

    constructor(statusBar: ShipItStatusBar) {
        this.ui = new UIManager(statusBar);
        this.taskRunner.setLogCallback((message, highlight) => this.ui.addLog(message, highlight));
    }

    setPanel(panel: IShipItUI | null): void { this.ui.setPanel(panel); }
    setSidebarView(view: IShipItUI): void { this.ui.setSidebarView(view); }
    setRequirements(requirements: TaskRequirements): void { this.taskRunner.setRequirements(requirements); }
    getRequirements(): TaskRequirements { return this.taskRunner.getRequirements(); }
    setSettings(settings: ShipItSettings): void { this.taskRunner.setSettings(settings); }
    getSettings(): ShipItSettings { return this.taskRunner.getSettings(); }

    // A single owner advances the workflow after the SDK has finished, never from file events.
    private async runOperation(work: () => Promise<void>): Promise<void> {
        if (this.operation) {
            vscode.window.showWarningMessage('ShipIt: An operation is already active. Stop it or wait for completion.');
            return;
        }
        if (!getWorkspaceRoot()) {
            vscode.window.showErrorMessage('ShipIt: No workspace folder open');
            return;
        }
        this.stopped = false;
        this.paused = false;
        const operation = Promise.resolve().then(work).catch(error => {
            logError('ShipIt operation failed', error);
            this.ui.addLog(`Operation failed: ${error instanceof Error ? error.message : String(error)}`, true);
            vscode.window.showErrorMessage(`ShipIt: ${error instanceof Error ? error.message : String(error)}`);
        }).finally(async () => {
            this.stopped = true;
            this.paused = false;
            this.resumeWaiter?.();
            this.resumeWaiter = null;
            this.countdownTimer.stop();
            this.inactivityMonitor.stop();
            this.activityWatcher.dispose();
            this.ui.hidePrdGenerating();
            this.ui.setActiveTask('');
            this.ui.setActiveUserStory('');
            this.ui.updateStatus('idle', this.taskRunner.getIterationCount(), '');
            this.ui.updateSessionTiming(0, this.taskRunner.getTaskHistory(), 0);
            await this.ui.refresh();
        });
        this.operation = operation;
        try {
            await operation;
        } finally {
            this.operation = null;
        }
    }

    private async waitUntilResumed(): Promise<boolean> {
        if (this.paused && !this.stopped) {
            await new Promise<void>(resolve => { this.resumeWaiter = resolve; });
        }
        return !this.stopped;
    }

    private async reviewDelay(): Promise<boolean> {
        if (!await this.waitUntilResumed()) { return false; }
        await this.ui.refresh();
        this.ui.addLog(`Starting next step in ${REVIEW_COUNTDOWN_SECONDS} seconds...`);
        await this.countdownTimer.start(REVIEW_COUNTDOWN_SECONDS, seconds => this.ui.updateCountdown(seconds));
        return this.waitUntilResumed();
    }

    private async execute(work: () => Promise<boolean>): Promise<boolean> {
        if (!await this.waitUntilResumed()) { return false; }
        this.ui.updateStatus('waiting', this.taskRunner.getIterationCount(), this.taskRunner.getCurrentTask());
        this.activityWatcher.start(() => this.inactivityMonitor.recordActivity());
        this.inactivityMonitor.start(async () => {
            const action = await vscode.window.showWarningMessage(
                'ShipIt: No file changes detected for 60 seconds. Copilot may still be working.',
                'Continue Waiting', 'Stop Loop'
            );
            if (action === 'Stop Loop' && !this.stopped) { await this.stopLoop(); }
        });
        try {
            const success = await work();
            if (this.stopped) { return false; }
            if (!success) { throw new Error('Copilot operation failed. Pending work has not been marked complete. See ShipIt logs.'); }
            return true;
        } finally {
            this.inactivityMonitor.stop();
            this.activityWatcher.dispose();
        }
    }

    async startLoop(): Promise<void> {
        await this.runOperation(async () => {
            if ((await getTaskStatsAsync()).pending === 0) {
                vscode.window.showInformationMessage('ShipIt: No pending tasks found in PRD.md');
                return;
            }
            if (!await ensureProgressFileAsync()) { throw new Error('Could not create the progress file'); }
            this.taskRunner.clearHistory();
            this.taskRunner.resetIterations();
            this.ui.clearLogs();
            this.ui.updateHistory([]);
            this.sessionStartTime = Date.now();
            const skipped = new Set<string>();
            this.ui.addLog('Starting ShipIt loop...');

            while (await this.waitUntilResumed()) {
                const tasks = await getAllTasksAsync();
                if (this.stopped) { return; }
                const task = tasks.find(item =>
                    (item.status === TaskStatus.PENDING || item.status === TaskStatus.IN_PROGRESS) &&
                    !skipped.has(item.description));
                if (!task) {
                    const incomplete = tasks.some(item => item.status !== TaskStatus.COMPLETE);
                    const message = incomplete
                        ? 'No runnable tasks remain. Skipped or blocked tasks are still incomplete.'
                        : `All PRD tasks completed! Total time: ${formatDuration(Date.now() - this.sessionStartTime)}`;
                    this.ui.addLog(message, true);
                    if (!await appendProgressAsync(message)) { throw new Error('Could not record progress'); }
                    vscode.window.showInformationMessage(`ShipIt: ${message}`);
                    return;
                }
                if (this.taskRunner.checkIterationLimit()) { return; }
                this.beginTask(task);
                this.ui.updateSessionTiming(this.sessionStartTime, this.taskRunner.getTaskHistory(), (await getTaskStatsAsync()).pending);
                const completed = await this.processTask(task);
                if (this.stopped) { return; }
                if (!completed) {
                    skipped.add(task.description);
                } else {
                    await this.recordCompletion();
                }
                if (!await this.reviewDelay()) { return; }
            }
        });
    }

    private beginTask(task: Task): void {
        const iteration = this.taskRunner.incrementIteration();
        this.taskRunner.setCurrentTask(task.description);
        this.ui.setIteration(iteration);
        this.ui.setTaskInfo(task.description);
        this.ui.setActiveTask(task.description);
        this.ui.updateStatus('running', iteration, task.description);
    }

    private async processTask(task: Task): Promise<boolean> {
        if (!await hasUserStoriesForTaskAsync(task.description)) {
            const action = await vscode.window.showWarningMessage(
                `No user stories found for task: "${task.description}". Generate user stories first or implement directly?`,
                'Generate Stories', 'Implement Directly', 'Skip Task', 'Stop Loop'
            );
            if (!await this.waitUntilResumed()) { return false; }
            if (action === 'Skip Task') { return false; }
            if (action === 'Implement Directly') {
                return this.implementDirectly(task);
            }
            if (action !== 'Generate Stories') {
                await this.stopLoop();
                return false;
            }
            if (!await this.generateStories(task)) { return false; }
            if (!await this.reviewDelay()) { return false; }
        }

        while (await this.waitUntilResumed()) {
            const story = await getNextUserStoryAsync(task.description);
            if (this.stopped) { return false; }
            if (!story) {
                const stats = await getUserStoryStatsAsync(task.description);
                if (stats.total === 0 || stats.pending !== 0) {
                    throw new Error(`User stories are missing or incomplete for: ${task.description}`);
                }
                if (!await markTaskCompleteAsync(task.description)) {
                    throw new Error(`Could not mark task complete: ${task.description}`);
                }
                return true;
            }
            this.ui.setActiveUserStory(story.description);
            this.ui.addLog(`User story: ${story.description}`);
            if (!await this.execute(() => this.taskRunner.triggerUserStoryImplementation(story.description, task.description))) {
                return false;
            }
            this.ui.setActiveUserStory('');
            if (!await this.reviewDelay()) { return false; }
        }
        return false;
    }

    private async implementDirectly(task: Task): Promise<boolean> {
        if (!await this.execute(() => this.taskRunner.triggerCopilotAgent(task.description))) { return false; }
        const updated = (await getAllTasksAsync()).find(item => item.description === task.description);
        if (updated?.status !== TaskStatus.COMPLETE) {
            throw new Error(`Copilot finished without marking the task complete in PRD.md: ${task.description}`);
        }
        return true;
    }

    private async recordCompletion(): Promise<void> {
        const completion = this.taskRunner.recordTaskCompletion();
        if (!await appendProgressAsync(`Completed: ${completion.taskDescription} (took ${formatDuration(completion.duration)})`)) {
            throw new Error('Could not record task progress');
        }
        this.ui.updateHistory(this.taskRunner.getTaskHistory());
        await this.ui.refresh();
    }

    pauseLoop(): void {
        if (!this.operation || this.stopped || this.paused) { return; }
        this.paused = true;
        this.countdownTimer.stop();
        this.inactivityMonitor.pause();
        this.ui.addLog('Loop paused. The current Copilot request may finish; no next step will start.');
        this.ui.updateStatus('paused', this.taskRunner.getIterationCount(), this.taskRunner.getCurrentTask());
    }

    resumeLoop(): void {
        if (!this.paused || this.stopped) { return; }
        this.paused = false;
        this.inactivityMonitor.resume();
        this.ui.addLog('Loop resumed');
        this.ui.updateStatus('running', this.taskRunner.getIterationCount(), this.taskRunner.getCurrentTask());
        this.resumeWaiter?.();
        this.resumeWaiter = null;
    }

    async stopLoop(): Promise<void> {
        this.stopped = true;
        this.paused = false;
        this.resumeWaiter?.();
        this.resumeWaiter = null;
        this.countdownTimer.stop();
        this.inactivityMonitor.stop();
        this.activityWatcher.dispose();
        await this.taskRunner.abortCopilot();
        this.ui.setActiveTask('');
        this.ui.setActiveUserStory('');
        this.ui.hidePrdGenerating();
        this.ui.updateStatus('idle', this.taskRunner.getIterationCount(), '');
        this.ui.updateSessionTiming(0, this.taskRunner.getTaskHistory(), 0);
        await this.ui.refresh();
    }

    async runSingleStep(): Promise<void> {
        await this.runOperation(async () => {
            const task = (await getAllTasksAsync()).find(item =>
                item.status === TaskStatus.PENDING || item.status === TaskStatus.IN_PROGRESS);
            if (!task) {
                vscode.window.showInformationMessage('ShipIt: No pending tasks in PRD.md');
                return;
            }
            if (this.stopped || this.taskRunner.checkIterationLimit()) { return; }
            this.beginTask(task);
            if (await this.implementDirectly(task)) { await this.recordCompletion(); }
        });
    }

    async generatePrdFromDescription(description: string): Promise<void> {
        await this.runOperation(async () => {
            this.ui.showPrdGenerating();
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification, title: 'ShipIt: Generating PRD', cancellable: false
            }, async () => {
                if (!await this.execute(() => this.taskRunner.triggerPrdGeneration(description))) { return; }
                const stats = await getTaskStatsAsync();
                if (stats.total === 0) { throw new Error('Copilot finished without creating PRD tasks'); }
                this.ui.addLog(`PRD created with ${stats.total} tasks`, true);
                vscode.window.showInformationMessage(`ShipIt: PRD created with ${stats.total} tasks.`);
            });
        });
    }

    private async generateStories(task: Task): Promise<boolean> {
        const success = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification, title: 'ShipIt: Generating user stories', cancellable: false
        }, () => this.execute(() => this.taskRunner.triggerUserStoriesGeneration(task.description, task.id)));
        if (!success) { return false; }
        if (!await hasUserStoriesForTaskAsync(task.description)) {
            throw new Error(`Copilot finished without creating user stories for: ${task.description}`);
        }
        this.ui.addLog(`User stories created for: ${task.description}`, true);
        await this.ui.refresh();
        return true;
    }

    async generateUserStoriesForTask(description: string): Promise<void> {
        await this.runOperation(async () => {
            const task = (await getAllTasksAsync()).find(item => item.description === description);
            if (!task) { throw new Error(`Task not found in PRD.md: ${description}`); }
            if (await hasUserStoriesForTaskAsync(description)) {
                vscode.window.showInformationMessage('ShipIt: User stories already exist for this task');
                return;
            }
            await this.generateStories(task);
        });
    }

    async generateAllUserStories(): Promise<void> {
        await this.runOperation(async () => {
            const tasks = (await getAllTasksAsync()).filter(item =>
                item.status === TaskStatus.PENDING || item.status === TaskStatus.IN_PROGRESS);
            let generated = 0;
            for (const task of tasks) {
                if (!await this.waitUntilResumed()) { return; }
                if (!await hasUserStoriesForTaskAsync(task.description)) {
                    if (!await this.generateStories(task)) { return; }
                    generated++;
                }
            }
            vscode.window.showInformationMessage(`ShipIt: Generated user stories for ${generated} tasks.`);
        });
    }

    async showStatus(stream: vscode.ChatResponseStream): Promise<void> {
        const stats = await getTaskStatsAsync();
        stream.markdown(`## ShipIt Status\n\n**State:** ${this.stopped ? 'IDLE' : this.paused ? 'PAUSED' : 'RUNNING'}\n\n`);
        stream.markdown(`**Tasks:** ${stats.completed}/${stats.total} complete\n\n**Iterations:** ${this.taskRunner.getIterationCount()}\n`);
    }

    async dispose(): Promise<void> {
        await this.stopLoop();
        await this.taskRunner.stopCopilotService();
    }
}
