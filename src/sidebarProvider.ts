import * as vscode from 'vscode';
import { IShipItUI, TaskCompletion, TaskStats, Task, UserStory, ModelSettings } from './types';
import { getTaskStatsAsync, getNextTaskAsync, getAllTasksAsync, getAllUserStoriesAsync, getUserStoryStatsAsync, getPrdPath } from './fileUtils';
import { getModelSettings, updateModelSetting } from './config';
import { getCopilotService } from './copilotSdk';
import { log } from './logger';

/**
 * Sidebar webview provider for ShipIt
 */
export class ShipItSidebarProvider implements vscode.WebviewViewProvider, IShipItUI {
    public static readonly viewType = 'shipit.sidebar';

    private _view?: vscode.WebviewView;
    private _status: string = 'idle';
    private _iteration: number = 0;
    private _currentTask: string = '';
    private _activeTaskDescription: string = '';
    private _activeUserStory: string = '';
    private _countdown: number = 0;
    private _history: TaskCompletion[] = [];
    private _logs: string[] = [];
    private _sessionStartTime: number = 0;
    private _pendingTasks: number = 0;
    private _isPrdGenerating: boolean = false;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'start':
                    vscode.commands.executeCommand('shipit.start');
                    break;
                case 'stop':
                    vscode.commands.executeCommand('shipit.stop');
                    break;
                case 'pause':
                    vscode.commands.executeCommand('shipit.pause');
                    break;
                case 'resume':
                    vscode.commands.executeCommand('shipit.resume');
                    break;
                case 'next':
                    vscode.commands.executeCommand('shipit.next');
                    break;
                case 'generatePrd':
                    vscode.commands.executeCommand('shipit.generatePrd');
                    break;
                case 'createManualPrd':
                    vscode.commands.executeCommand('shipit.createManualPrd');
                    break;
                case 'generateUserStories':
                    if (data.taskDescription) {
                        vscode.commands.executeCommand('shipit.generateUserStories', data.taskDescription);
                    }
                    break;
                case 'generateAllUserStories':
                    vscode.commands.executeCommand('shipit.generateAllUserStories');
                    break;
                case 'viewLogs':
                    vscode.commands.executeCommand('shipit.viewLogs');
                    break;
                case 'openPrd':
                    this._openPrdFile();
                    break;
                case 'refresh':
                    await this.refresh();
                    break;
                case 'ready':
                    // Webview is ready, send initial state
                    await this.refresh();
                    await this._sendSettings();
                    break;
                case 'getSettings':
                    await this._sendSettings();
                    break;
                case 'updateModelSetting':
                    if (data.key && data.value) {
                        await updateModelSetting(data.key as keyof ModelSettings, data.value);
                        await this._sendSettings();
                    }
                    break;
            }
        });

        log('Sidebar webview resolved');
    }

    /**
     * Open PRD file in editor
     */
    private async _openPrdFile(): Promise<void> {
        const prdPathStr = getPrdPath();
        if (!prdPathStr) { 
            vscode.window.showWarningMessage('No workspace folder open');
            return; 
        }

        const prdPath = vscode.Uri.file(prdPathStr);
        try {
            const doc = await vscode.workspace.openTextDocument(prdPath);
            await vscode.window.showTextDocument(doc);
        } catch {
            vscode.window.showWarningMessage('PRD not found. Generate one first.');
        }
    }

    /**
     * Send current settings and available models to webview
     */
    private async _sendSettings(): Promise<void> {
        if (!this._view) { return; }

        try {
            const modelSettings = getModelSettings();
            const copilotService = getCopilotService();
            const availableModels = await copilotService.getAvailableModels();

            this._view.webview.postMessage({
                type: 'settings',
                modelSettings,
                availableModels
            });
        } catch (error) {
            log(`Error sending settings: ${error}`);
        }
    }

    // IShipItUI implementation

    updateStatus(status: string, iteration: number, currentTask: string, history: TaskCompletion[] = []): void {
        this._status = status;
        this._iteration = iteration;
        this._currentTask = currentTask;
        if (history.length > 0) {
            this._history = history;
        }
        this._sendUpdate();
    }

    updateCountdown(seconds: number): void {
        this._countdown = seconds;
        this._sendUpdate();
    }

    updateHistory(history: TaskCompletion[]): void {
        this._history = history;
        this._sendUpdate();
    }

    updateSessionTiming(startTime: number, taskHistory: TaskCompletion[], pendingTasks: number): void {
        this._sessionStartTime = startTime;
        this._pendingTasks = pendingTasks;
        this._history = taskHistory;
        this._sendUpdate();
    }

    async updateStats(): Promise<void> {
        await this.refresh();
    }

    async refresh(): Promise<void> {
        const stats = await getTaskStatsAsync();
        const tasks = await getAllTasksAsync();
        const nextTask = await getNextTaskAsync();
        const userStories = await getAllUserStoriesAsync();
        this._pendingTasks = stats.pending;
        this._sendFullState(stats, tasks, nextTask, userStories);
    }

    addLog(message: string, highlight: boolean = false): void {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = highlight ? `⭐ ${timestamp}: ${message}` : `${timestamp}: ${message}`;
        this._logs.push(logEntry);
        // Keep only last 50 logs
        if (this._logs.length > 50) {
            this._logs = this._logs.slice(-50);
        }
        this._sendUpdate();
    }

    clearLogs(): void {
        this._logs = [];
        this._sendUpdate();
    }

    showPrdGenerating(): void {
        this._isPrdGenerating = true;
        this._sendUpdate();
    }

    setActiveTask(taskDescription: string): void {
        this._activeTaskDescription = taskDescription;
        this._sendUpdate();
    }

    setActiveUserStory(userStoryDescription: string): void {
        this._activeUserStory = userStoryDescription;
        this._sendUpdate();
    }

    /**
     * Send full state to webview
     */
    private _sendFullState(stats: TaskStats, tasks: Task[], nextTask: Task | null, userStories: UserStory[] = []): void {
        if (!this._view) { return; }

        this._view.webview.postMessage({
            type: 'fullState',
            status: this._status,
            iteration: this._iteration,
            currentTask: this._currentTask,
            activeTaskDescription: this._activeTaskDescription,
            activeUserStory: this._activeUserStory,
            countdown: this._countdown,
            history: this._history,
            logs: this._logs,
            sessionStartTime: this._sessionStartTime,
            pendingTasks: this._pendingTasks,
            isPrdGenerating: this._isPrdGenerating,
            stats: stats,
            tasks: tasks,
            nextTask: nextTask,
            userStories: userStories
        });
    }

    /**
     * Send incremental update to webview
     */
    private _sendUpdate(): void {
        if (!this._view) { return; }

        this._view.webview.postMessage({
            type: 'update',
            status: this._status,
            iteration: this._iteration,
            currentTask: this._currentTask,
            activeTaskDescription: this._activeTaskDescription,
            activeUserStory: this._activeUserStory,
            countdown: this._countdown,
            history: this._history,
            logs: this._logs,
            sessionStartTime: this._sessionStartTime,
            pendingTasks: this._pendingTasks,
            isPrdGenerating: this._isPrdGenerating
        });
    }

    /**
     * Generate the HTML for the webview
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ShipIt</title>
    <style>
        :root {
            --card-bg: var(--vscode-editor-background);
            --card-border: var(--vscode-panel-border);
            --accent-green: var(--vscode-charts-green);
            --accent-yellow: var(--vscode-charts-yellow);
            --accent-orange: var(--vscode-charts-orange);
            --accent-blue: var(--vscode-charts-blue);
            --radius-sm: 4px;
            --radius-md: 8px;
            --radius-lg: 12px;
        }
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            padding: 0;
            line-height: 1.5;
            background: transparent;
        }
        
        /* Header */
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 16px 12px;
            background: linear-gradient(135deg, var(--vscode-sideBar-background) 0%, var(--card-bg) 100%);
            border-bottom: 1px solid var(--card-border);
            position: sticky;
            top: 0;
            z-index: 100;
        }
        .header-brand {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .header-logo {
            font-size: 20px;
        }
        .header-title {
            font-size: 15px;
            font-weight: 700;
            letter-spacing: -0.3px;
        }
        .header-right {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .elapsed-badge {
            font-size: 11px;
            font-family: var(--vscode-editor-font-family);
            color: var(--vscode-descriptionForeground);
            background: var(--card-bg);
            padding: 3px 8px;
            border-radius: var(--radius-sm);
            border: 1px solid var(--card-border);
        }
        .elapsed-badge .time {
            font-weight: 600;
            color: var(--vscode-foreground);
        }
        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }
        .status-badge::before {
            content: '';
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: currentColor;
        }
        .status-idle {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }
        .status-running {
            background: rgba(40, 167, 69, 0.15);
            color: var(--accent-green);
            animation: pulse 2s infinite;
        }
        .status-waiting {
            background: rgba(255, 193, 7, 0.15);
            color: var(--accent-yellow);
        }
        .status-paused {
            background: rgba(253, 126, 20, 0.15);
            color: var(--accent-orange);
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }

        /* Main content */
        .main-content {
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        /* Cards */
        .card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: var(--radius-md);
            overflow: hidden;
        }
        .card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 12px;
            background: rgba(128,128,128,0.03);
            border-bottom: 1px solid var(--card-border);
        }
        .card-title {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--vscode-descriptionForeground);
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .card-title-icon {
            font-size: 12px;
        }
        .card-actions {
            display: flex;
            gap: 8px;
        }
        .card-action {
            font-size: 10px;
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            text-decoration: none;
            opacity: 0.8;
            transition: opacity 0.2s;
        }
        .card-action:hover {
            opacity: 1;
            text-decoration: underline;
        }
        .card-body {
            padding: 12px;
        }

        /* Progress Stats */
        .progress-stats {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
        }
        .stat-item {
            text-align: center;
            padding: 12px 8px;
            background: rgba(128,128,128,0.05);
            border-radius: var(--radius-sm);
        }
        .stat-value {
            font-size: 24px;
            font-weight: 700;
            line-height: 1;
            margin-bottom: 4px;
        }
        .stat-value.done { color: var(--accent-green); }
        .stat-value.pending { color: var(--accent-yellow); }
        .stat-value.iteration { color: var(--accent-blue); }
        .stat-label {
            font-size: 9px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--vscode-descriptionForeground);
            font-weight: 600;
        }

        /* Progress bar */
        .progress-bar-container {
            margin-top: 12px;
            background: rgba(128,128,128,0.1);
            border-radius: 10px;
            height: 8px;
            overflow: hidden;
        }
        .progress-bar {
            height: 100%;
            background: linear-gradient(90deg, var(--accent-green) 0%, var(--accent-blue) 100%);
            border-radius: 10px;
            transition: width 0.5s ease;
        }

        /* Countdown */
        .countdown-card {
            background: linear-gradient(135deg, rgba(0,122,204,0.1) 0%, rgba(0,122,204,0.05) 100%);
            border-color: var(--vscode-inputValidation-infoBorder);
            display: none;
        }
        .countdown-card.visible {
            display: block;
        }
        .countdown-content {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            padding: 16px;
        }
        .countdown-value {
            font-size: 32px;
            font-weight: 700;
            color: var(--vscode-foreground);
        }
        .countdown-label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        /* Current Work */
        .current-work {
            background: linear-gradient(135deg, rgba(40,167,69,0.1) 0%, rgba(40,167,69,0.02) 100%);
            border-color: var(--accent-green);
        }
        .current-work .card-body {
            padding: 14px;
        }
        .work-item {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            margin-bottom: 10px;
        }
        .work-item:last-child {
            margin-bottom: 0;
        }
        .work-icon {
            font-size: 14px;
            flex-shrink: 0;
        }
        .work-content {
            flex: 1;
        }
        .work-label {
            font-size: 9px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 2px;
        }
        .work-text {
            font-size: 12px;
            line-height: 1.4;
            word-break: break-word;
        }

        /* Controls */
        .controls-grid {
            display: grid;
            gap: 8px;
        }
        .controls-row {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
        }
        .controls-row.single {
            grid-template-columns: 1fr;
        }
        button {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 10px 14px;
            border: none;
            border-radius: var(--radius-sm);
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }
        button:hover:not(:disabled) {
            filter: brightness(1.1);
            transform: translateY(-1px);
        }
        button:active:not(:disabled) {
            transform: translateY(0);
        }
        button:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        .btn-icon {
            font-size: 12px;
        }
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn-success {
            background: var(--accent-green);
            color: white;
        }
        .btn-danger {
            background: var(--vscode-errorForeground);
            color: white;
        }
        .btn-large {
            padding: 12px 16px;
            font-size: 13px;
            font-weight: 600;
        }

        /* Task list */
        .task-list {
            max-height: 250px;
            overflow-y: auto;
        }
        .task-item {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 10px 0;
            border-bottom: 1px solid rgba(128,128,128,0.1);
        }
        .task-item:last-child {
            border-bottom: none;
            padding-bottom: 0;
        }
        .task-item:first-child {
            padding-top: 0;
        }
        .task-checkbox {
            width: 18px;
            height: 18px;
            border: 2px solid var(--vscode-checkbox-border);
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            font-size: 10px;
            font-weight: bold;
            transition: all 0.2s;
        }
        .task-checkbox.completed {
            background: var(--accent-green);
            border-color: var(--accent-green);
            color: white;
        }
        .task-checkbox.blocked {
            background: var(--vscode-errorForeground);
            border-color: var(--vscode-errorForeground);
            color: white;
        }
        .task-checkbox.in-progress {
            background: var(--accent-yellow);
            border-color: var(--accent-yellow);
            color: black;
            animation: pulse 2s infinite;
        }
        .task-content {
            flex: 1;
            min-width: 0;
        }
        .task-text {
            font-size: 12px;
            line-height: 1.4;
            word-break: break-word;
        }
        .task-text.completed {
            text-decoration: line-through;
            opacity: 0.6;
        }
        .task-meta {
            display: flex;
            gap: 6px;
            margin-top: 4px;
        }
        .task-badge {
            font-size: 9px;
            padding: 2px 6px;
            border-radius: 10px;
            background: rgba(128,128,128,0.1);
            color: var(--vscode-descriptionForeground);
        }
        .task-badge.has-stories {
            background: rgba(40,167,69,0.15);
            color: var(--accent-green);
        }
        .task-action-btn {
            font-size: 9px;
            padding: 3px 8px;
            border: none;
            border-radius: 10px;
            cursor: pointer;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            transition: all 0.2s;
        }
        .task-action-btn:hover {
            filter: brightness(1.1);
        }

        /* User Stories Section */
        .stories-group {
            margin-bottom: 12px;
        }
        .stories-group:last-child {
            margin-bottom: 0;
        }
        .stories-group-header {
            font-size: 10px;
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 6px;
            padding-bottom: 4px;
            border-bottom: 1px dashed rgba(128,128,128,0.2);
            display: flex;
            justify-content: space-between;
        }
        .stories-progress {
            color: var(--accent-green);
        }

        /* Logs */
        .logs-container {
            max-height: 120px;
            overflow-y: auto;
            font-family: var(--vscode-editor-font-family);
            font-size: 10px;
            line-height: 1.6;
        }
        .log-entry {
            padding: 2px 0;
            color: var(--vscode-descriptionForeground);
            word-break: break-word;
        }
        .log-entry.highlight {
            color: var(--accent-green);
            font-weight: 600;
        }

        /* Empty state */
        .empty-state {
            text-align: center;
            padding: 24px 16px;
            color: var(--vscode-descriptionForeground);
        }
        .empty-icon {
            font-size: 36px;
            margin-bottom: 12px;
            opacity: 0.5;
        }
        .empty-title {
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 6px;
            color: var(--vscode-foreground);
        }
        .empty-text {
            font-size: 11px;
            margin-bottom: 12px;
        }
        .empty-actions {
            display: flex;
            gap: 8px;
            justify-content: center;
        }

        /* Settings */
        .settings-container {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .settings-row {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .settings-label {
            font-size: 10px;
            font-weight: 500;
            color: var(--vscode-descriptionForeground);
        }
        .settings-select {
            padding: 6px 10px;
            border-radius: var(--radius-sm);
            border: 1px solid var(--vscode-dropdown-border);
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            font-size: 11px;
            cursor: pointer;
        }
        .settings-select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        /* Collapsible */
        .collapsible-header {
            display: flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
            user-select: none;
        }
        .collapsible-header:hover .card-title {
            color: var(--vscode-foreground);
        }
        .chevron {
            font-size: 10px;
            transition: transform 0.2s;
        }
        .chevron.collapsed {
            transform: rotate(-90deg);
        }
        .collapsible-content {
            max-height: 500px;
            overflow: hidden;
            transition: max-height 0.3s ease;
        }
        .collapsible-content.collapsed {
            max-height: 0;
        }

        /* Utilities */
        .hidden { display: none !important; }
        .link {
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
        }
        .link:hover {
            text-decoration: underline;
        }

        /* Scrollbar */
        ::-webkit-scrollbar {
            width: 6px;
        }
        ::-webkit-scrollbar-track {
            background: transparent;
        }
        ::-webkit-scrollbar-thumb {
            background: rgba(128,128,128,0.3);
            border-radius: 3px;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: rgba(128,128,128,0.5);
        }
    </style>
</head>
<body>
    <!-- Header -->
    <div class="header">
        <div class="header-brand">
            <span class="header-logo">🚀</span>
            <span class="header-title">ShipIt</span>
        </div>
        <div class="header-right">
            <span id="elapsedBadge" class="elapsed-badge hidden">
                <span class="time" id="elapsedTime">00:00:00</span>
            </span>
            <span id="statusBadge" class="status-badge status-idle">Idle</span>
        </div>
    </div>

    <div class="main-content">
        <!-- Progress Stats -->
        <div class="card">
            <div class="card-body" style="padding: 10px 12px;">
                <div class="progress-stats">
                    <div class="stat-item">
                        <div class="stat-value done" id="completedCount">0</div>
                        <div class="stat-label">Done</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value pending" id="pendingCount">0</div>
                        <div class="stat-label">Pending</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value iteration" id="iterationCount">0</div>
                        <div class="stat-label">Iteration</div>
                    </div>
                </div>
                <div class="progress-bar-container">
                    <div class="progress-bar" id="progressBar" style="width: 0%"></div>
                </div>
            </div>
        </div>

        <!-- Countdown -->
        <div class="card countdown-card" id="countdownCard">
            <div class="countdown-content">
                <div class="countdown-value" id="countdownValue">0</div>
                <div class="countdown-label">seconds until next task</div>
            </div>
        </div>

        <!-- Current Work -->
        <div class="card current-work hidden" id="currentWorkCard">
            <div class="card-header">
                <div class="card-title">
                    <span class="card-title-icon">⚡</span>
                    Currently Working
                </div>
            </div>
            <div class="card-body">
                <div class="work-item">
                    <span class="work-icon">📋</span>
                    <div class="work-content">
                        <div class="work-label">Task</div>
                        <div class="work-text" id="currentTaskText"></div>
                    </div>
                </div>
                <div class="work-item hidden" id="currentStoryItem">
                    <span class="work-icon">📖</span>
                    <div class="work-content">
                        <div class="work-label">User Story</div>
                        <div class="work-text" id="currentUserStoryText"></div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Controls -->
        <div class="card">
            <div class="card-header">
                <div class="card-title">
                    <span class="card-title-icon">🎮</span>
                    Controls
                </div>
            </div>
            <div class="card-body">
                <div class="controls-grid">
                    <div class="controls-row">
                        <button id="btnStart" class="btn-success btn-large">
                            <span class="btn-icon">▶</span> Start
                        </button>
                        <button id="btnStop" class="btn-danger btn-large" disabled>
                            <span class="btn-icon">⏹</span> Stop
                        </button>
                    </div>
                    <div class="controls-row">
                        <button id="btnPause" class="btn-secondary" disabled>
                            <span class="btn-icon">⏸</span> Pause
                        </button>
                        <button id="btnResume" class="btn-secondary" disabled>
                            <span class="btn-icon">▶</span> Resume
                        </button>
                    </div>
                    <div class="controls-row single">
                        <button id="btnNext" class="btn-secondary">
                            <span class="btn-icon">⏭</span> Run Single Step
                        </button>
                    </div>
                    <div class="controls-row">
                        <button id="btnGenerate" class="btn-primary">
                            <span class="btn-icon">🤖</span> AI Generate
                        </button>
                        <button id="btnManualPrd" class="btn-secondary">
                            <span class="btn-icon">✏️</span> Write PRD
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Tasks -->
        <div class="card">
            <div class="card-header">
                <div class="card-title">
                    <span class="card-title-icon">📋</span>
                    Tasks
                </div>
                <div class="card-actions">
                    <span id="generateAllStoriesLink" class="card-action hidden">Gen All Stories</span>
                    <span id="openPrdLink" class="card-action">Open PRD</span>
                </div>
            </div>
            <div class="card-body">
                <div id="taskList" class="task-list">
                    <div class="empty-state">
                        <div class="empty-icon">📋</div>
                        <div class="empty-title">No PRD Found</div>
                        <div class="empty-text">Create a Product Requirements Document to get started</div>
                        <div class="empty-actions">
                            <button id="emptyGenPrd" class="btn-primary">🤖 AI Generate</button>
                            <button id="emptyWritePrd" class="btn-secondary">✏️ Write PRD</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- User Stories -->
        <div class="card hidden" id="userStoriesCard">
            <div class="card-header">
                <div class="card-title">
                    <span class="card-title-icon">📖</span>
                    User Stories
                </div>
            </div>
            <div class="card-body">
                <div id="userStoriesList" class="task-list"></div>
            </div>
        </div>

        <!-- Activity Log -->
        <div class="card">
            <div class="card-header collapsible-header" id="logsHeader">
                <div class="card-title">
                    <span class="chevron" id="logsChevron">▼</span>
                    <span class="card-title-icon">📝</span>
                    Activity Log
                </div>
                <div class="card-actions">
                    <span id="viewLogsLink" class="card-action">Full Logs</span>
                </div>
            </div>
            <div class="collapsible-content" id="logsContent">
                <div class="card-body" style="padding-top: 0;">
                    <div id="logsContainer" class="logs-container">
                        <div class="log-entry" style="opacity: 0.5;">No activity yet</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Settings -->
        <div class="card">
            <div class="card-header collapsible-header" id="settingsHeader">
                <div class="card-title">
                    <span class="chevron collapsed" id="settingsChevron">▼</span>
                    <span class="card-title-icon">⚙️</span>
                    Model Settings
                </div>
            </div>
            <div class="collapsible-content collapsed" id="settingsContent">
                <div class="card-body" style="padding-top: 0;">
                    <div class="settings-container">
                        <div class="settings-row">
                            <label class="settings-label">PRD Generation</label>
                            <select class="settings-select" id="modelPrd">
                                <option value="">Loading...</option>
                            </select>
                        </div>
                        <div class="settings-row">
                            <label class="settings-label">User Stories</label>
                            <select class="settings-select" id="modelStories">
                                <option value="">Loading...</option>
                            </select>
                        </div>
                        <div class="settings-row">
                            <label class="settings-label">Task Implementation</label>
                            <select class="settings-select" id="modelTask">
                                <option value="">Loading...</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        function send(type) {
            vscode.postMessage({ type });
        }

        // State
        let state = {
            status: 'idle',
            iteration: 0,
            currentTask: '',
            activeTaskDescription: '',
            activeUserStory: '',
            countdown: 0,
            sessionStartTime: 0,
            stats: { total: 0, completed: 0, pending: 0 },
            tasks: [],
            userStories: [],
            logs: []
        };

        // Settings state
        let settingsState = {
            modelSettings: {
                prdGeneration: '',
                userStoriesGeneration: '',
                taskImplementation: ''
            },
            availableModels: []
        };

        // Collapsible states
        let logsCollapsed = false;
        let settingsCollapsed = true;

        // Elapsed time timer
        let elapsedTimer = null;

        function formatElapsedTime(ms) {
            const totalSeconds = Math.floor(ms / 1000);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;
            return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
        }

        function updateElapsedTime() {
            if (state.sessionStartTime > 0) {
                const elapsed = Date.now() - state.sessionStartTime;
                document.getElementById('elapsedTime').textContent = formatElapsedTime(elapsed);
            }
        }

        function startElapsedTimer() {
            if (elapsedTimer) { clearInterval(elapsedTimer); }
            elapsedTimer = setInterval(updateElapsedTime, 1000);
            updateElapsedTime();
        }

        function stopElapsedTimer() {
            if (elapsedTimer) {
                clearInterval(elapsedTimer);
                elapsedTimer = null;
            }
        }

        // Update UI based on state
        function updateUI() {
            // Status badge
            const badge = document.getElementById('statusBadge');
            badge.className = 'status-badge status-' + state.status;
            const statusText = {
                'idle': 'Idle',
                'running': 'Running',
                'waiting': 'Waiting',
                'paused': 'Paused'
            };
            badge.textContent = statusText[state.status] || state.status;

            // Stats
            const completed = state.stats.completed || 0;
            const total = state.stats.total || 0;
            const pending = state.stats.pending || 0;
            
            document.getElementById('completedCount').textContent = completed;
            document.getElementById('pendingCount').textContent = pending;
            document.getElementById('iterationCount').textContent = state.iteration;

            // Progress bar
            const progressPercent = total > 0 ? (completed / total) * 100 : 0;
            document.getElementById('progressBar').style.width = progressPercent + '%';

            // Elapsed time
            const elapsedBadge = document.getElementById('elapsedBadge');
            const isActive = state.status === 'running' || state.status === 'waiting' || state.status === 'paused';
            if (isActive && state.sessionStartTime > 0) {
                elapsedBadge.classList.remove('hidden');
                startElapsedTimer();
            } else {
                elapsedBadge.classList.add('hidden');
                stopElapsedTimer();
            }

            // Countdown
            const countdownCard = document.getElementById('countdownCard');
            if (state.countdown > 0) {
                countdownCard.classList.add('visible');
                document.getElementById('countdownValue').textContent = state.countdown;
            } else {
                countdownCard.classList.remove('visible');
            }

            // Current work
            const currentWorkCard = document.getElementById('currentWorkCard');
            const currentStoryItem = document.getElementById('currentStoryItem');
            if (state.currentTask && (state.status === 'running' || state.status === 'waiting')) {
                currentWorkCard.classList.remove('hidden');
                document.getElementById('currentTaskText').textContent = state.currentTask;
                
                if (state.activeUserStory) {
                    currentStoryItem.classList.remove('hidden');
                    document.getElementById('currentUserStoryText').textContent = state.activeUserStory;
                } else {
                    currentStoryItem.classList.add('hidden');
                }
            } else {
                currentWorkCard.classList.add('hidden');
            }

            // Buttons
            const isRunning = state.status === 'running' || state.status === 'waiting';
            const isPaused = state.status === 'paused';
            
            document.getElementById('btnStart').disabled = isRunning || isPaused;
            document.getElementById('btnStop').disabled = !isRunning && !isPaused;
            document.getElementById('btnPause').disabled = !isRunning;
            document.getElementById('btnResume').disabled = !isPaused;
            document.getElementById('btnNext').disabled = isRunning;

            // Task list
            renderTasks();

            // User stories
            renderUserStories();

            // Logs
            renderLogs();
        }

        function renderTasks() {
            const container = document.getElementById('taskList');
            const genAllLink = document.getElementById('generateAllStoriesLink');
            
            if (!state.tasks || state.tasks.length === 0) {
                container.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-icon">📋</div>
                        <div class="empty-title">No PRD Found</div>
                        <div class="empty-text">Create a Product Requirements Document to get started</div>
                        <div class="empty-actions">
                            <button id="emptyGenPrd" class="btn-primary">🤖 AI Generate</button>
                            <button id="emptyWritePrd" class="btn-secondary">✏️ Write PRD</button>
                        </div>
                    </div>
                \`;
                genAllLink.classList.add('hidden');
                
                document.getElementById('emptyGenPrd')?.addEventListener('click', () => send('generatePrd'));
                document.getElementById('emptyWritePrd')?.addEventListener('click', () => send('createManualPrd'));
                return;
            }

            // Show/hide generate all stories link
            const tasksNeedingStories = state.tasks.filter(t => !t.hasUserStories && t.status !== 'COMPLETE');
            if (tasksNeedingStories.length > 0) {
                genAllLink.classList.remove('hidden');
            } else {
                genAllLink.classList.add('hidden');
            }

            const isActive = state.status === 'running' || state.status === 'waiting';

            const html = state.tasks.map((task, index) => {
                let checkboxClass = 'task-checkbox';
                let textClass = 'task-text';
                let icon = '';
                
                const isCurrentTask = isActive && state.activeTaskDescription && 
                    task.description === state.activeTaskDescription;
                
                if (isCurrentTask && task.status !== 'COMPLETE') {
                    checkboxClass += ' in-progress';
                    icon = '⚡';
                } else {
                    switch (task.status) {
                        case 'COMPLETE':
                            checkboxClass += ' completed';
                            textClass += ' completed';
                            icon = '✓';
                            break;
                        case 'BLOCKED':
                            checkboxClass += ' blocked';
                            icon = '!';
                            break;
                        case 'IN_PROGRESS':
                            checkboxClass += ' in-progress';
                            icon = '⚡';
                            break;
                        default:
                            icon = '';
                    }
                }

                let metaHtml = '';
                if (task.status !== 'COMPLETE') {
                    if (task.hasUserStories) {
                        metaHtml = '<span class="task-badge has-stories">✓ Stories</span>';
                    } else {
                        metaHtml = '<button class="task-action-btn" data-task-index="' + index + '">+ Stories</button>';
                    }
                }

                return \`
                    <div class="task-item">
                        <div class="\${checkboxClass}">\${icon}</div>
                        <div class="task-content">
                            <div class="\${textClass}">\${escapeHtml(task.description)}</div>
                            <div class="task-meta">\${metaHtml}</div>
                        </div>
                    </div>
                \`;
            }).join('');

            container.innerHTML = html;

            container.querySelectorAll('.task-action-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const index = parseInt(e.target.getAttribute('data-task-index'), 10);
                    const task = state.tasks[index];
                    if (task) {
                        vscode.postMessage({ type: 'generateUserStories', taskDescription: task.description });
                    }
                });
            });
        }

        function renderUserStories() {
            const container = document.getElementById('userStoriesList');
            const card = document.getElementById('userStoriesCard');
            
            if (!state.userStories || state.userStories.length === 0) {
                card.classList.add('hidden');
                return;
            }
            
            card.classList.remove('hidden');

            const storiesByTask = {};
            state.userStories.forEach(story => {
                if (!storiesByTask[story.taskId]) {
                    storiesByTask[story.taskId] = [];
                }
                storiesByTask[story.taskId].push(story);
            });

            let html = '';
            for (const taskId in storiesByTask) {
                const stories = storiesByTask[taskId];
                const completed = stories.filter(s => s.status === 'COMPLETE').length;
                
                html += \`<div class="stories-group">\`;
                html += \`<div class="stories-group-header">
                    <span>\${escapeHtml(taskId.substring(0, 50))}...</span>
                    <span class="stories-progress">\${completed}/\${stories.length}</span>
                </div>\`;
                
                stories.forEach(story => {
                    let checkboxClass = 'task-checkbox';
                    let textClass = 'task-text';
                    let icon = '';
                    
                    switch (story.status) {
                        case 'COMPLETE':
                            checkboxClass += ' completed';
                            textClass += ' completed';
                            icon = '✓';
                            break;
                        case 'IN_PROGRESS':
                            checkboxClass += ' in-progress';
                            icon = '⚡';
                            break;
                        default:
                            icon = '';
                    }

                    html += \`
                        <div class="task-item">
                            <div class="\${checkboxClass}">\${icon}</div>
                            <div class="task-content">
                                <div class="\${textClass}">\${escapeHtml(story.description)}</div>
                            </div>
                        </div>
                    \`;
                });
                
                html += '</div>';
            }

            container.innerHTML = html;
        }

        function renderLogs() {
            const container = document.getElementById('logsContainer');
            
            if (!state.logs || state.logs.length === 0) {
                container.innerHTML = '<div class="log-entry" style="opacity: 0.5;">No activity yet</div>';
                return;
            }

            const html = state.logs.slice(-25).map(log => {
                const isHighlight = log.startsWith('⭐');
                return '<div class="log-entry' + (isHighlight ? ' highlight' : '') + '">' + escapeHtml(log) + '</div>';
            }).join('');

            container.innerHTML = html;
            container.scrollTop = container.scrollHeight;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function populateModelSelect(selectId, models, selectedValue) {
            const select = document.getElementById(selectId);
            if (!select) return;
            
            select.innerHTML = '';
            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                if (model === selectedValue) {
                    option.selected = true;
                }
                select.appendChild(option);
            });
        }

        function updateSettingsUI() {
            const models = settingsState.availableModels;
            const settings = settingsState.modelSettings;
            
            populateModelSelect('modelPrd', models, settings.prdGeneration);
            populateModelSelect('modelStories', models, settings.userStoriesGeneration);
            populateModelSelect('modelTask', models, settings.taskImplementation);
        }

        function toggleCollapsible(chevronId, contentId, isCollapsedVar) {
            const chevron = document.getElementById(chevronId);
            const content = document.getElementById(contentId);
            
            if (chevronId === 'settingsChevron') {
                settingsCollapsed = !settingsCollapsed;
                if (settingsCollapsed) {
                    chevron.classList.add('collapsed');
                    content.classList.add('collapsed');
                } else {
                    chevron.classList.remove('collapsed');
                    content.classList.remove('collapsed');
                }
            } else if (chevronId === 'logsChevron') {
                logsCollapsed = !logsCollapsed;
                if (logsCollapsed) {
                    chevron.classList.add('collapsed');
                    content.classList.add('collapsed');
                } else {
                    chevron.classList.remove('collapsed');
                    content.classList.remove('collapsed');
                }
            }
        }

        function onModelChange(key, value) {
            vscode.postMessage({ type: 'updateModelSetting', key, value });
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            if (message.type === 'fullState' || message.type === 'update') {
                state.status = message.status || state.status;
                state.iteration = message.iteration || 0;
                state.currentTask = message.currentTask || '';
                state.activeTaskDescription = message.activeTaskDescription || state.activeTaskDescription;
                state.activeUserStory = message.activeUserStory || '';
                state.countdown = message.countdown || 0;
                state.logs = message.logs || state.logs;
                
                if (message.stats) {
                    state.stats = message.stats;
                }
                if (message.tasks) {
                    state.tasks = message.tasks;
                }
                if (message.userStories) {
                    state.userStories = message.userStories;
                }
                if (message.sessionStartTime !== undefined) {
                    state.sessionStartTime = message.sessionStartTime;
                }
                
                updateUI();
            }

            if (message.type === 'settings') {
                if (message.modelSettings) {
                    settingsState.modelSettings = message.modelSettings;
                }
                if (message.availableModels) {
                    settingsState.availableModels = message.availableModels;
                }
                updateSettingsUI();
            }
        });

        // Initial render and notify ready
        updateUI();
        
        // Event listeners
        document.getElementById('btnStart').addEventListener('click', () => send('start'));
        document.getElementById('btnStop').addEventListener('click', () => send('stop'));
        document.getElementById('btnPause').addEventListener('click', () => send('pause'));
        document.getElementById('btnResume').addEventListener('click', () => send('resume'));
        document.getElementById('btnNext').addEventListener('click', () => send('next'));
        document.getElementById('btnGenerate').addEventListener('click', () => send('generatePrd'));
        document.getElementById('btnManualPrd').addEventListener('click', () => send('createManualPrd'));
        document.getElementById('openPrdLink').addEventListener('click', () => send('openPrd'));
        document.getElementById('viewLogsLink').addEventListener('click', () => send('viewLogs'));
        document.getElementById('generateAllStoriesLink').addEventListener('click', () => send('generateAllUserStories'));

        document.getElementById('settingsHeader').addEventListener('click', () => toggleCollapsible('settingsChevron', 'settingsContent'));
        document.getElementById('logsHeader').addEventListener('click', () => toggleCollapsible('logsChevron', 'logsContent'));
        
        document.getElementById('modelPrd').addEventListener('change', (e) => onModelChange('prdGeneration', e.target.value));
        document.getElementById('modelStories').addEventListener('change', (e) => onModelChange('userStoriesGeneration', e.target.value));
        document.getElementById('modelTask').addEventListener('change', (e) => onModelChange('taskImplementation', e.target.value));
        
        send('ready');
    </script>
</body>
</html>`;
    }
}

/**
 * Generate a nonce for CSP
 */
function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
