import * as vscode from 'vscode';
import { IPilotFlowUI, TaskCompletion, TaskStats, Task, UserStory } from './types';
import { getTaskStatsAsync, getNextTaskAsync, getAllTasksAsync, getAllUserStoriesAsync, getUserStoryStatsAsync } from './fileUtils';
import { log } from './logger';

/**
 * Sidebar webview provider for PilotFlow
 */
export class PilotFlowSidebarProvider implements vscode.WebviewViewProvider, IPilotFlowUI {
    public static readonly viewType = 'pilotflow.sidebar';

    private _view?: vscode.WebviewView;
    private _status: string = 'idle';
    private _iteration: number = 0;
    private _currentTask: string = '';
    private _activeTaskDescription: string = '';
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
                    vscode.commands.executeCommand('pilotflow.start');
                    break;
                case 'stop':
                    vscode.commands.executeCommand('pilotflow.stop');
                    break;
                case 'pause':
                    vscode.commands.executeCommand('pilotflow.pause');
                    break;
                case 'resume':
                    vscode.commands.executeCommand('pilotflow.resume');
                    break;
                case 'next':
                    vscode.commands.executeCommand('pilotflow.next');
                    break;
                case 'generatePrd':
                    vscode.commands.executeCommand('pilotflow.generatePrd');
                    break;
                case 'generateUserStories':
                    if (data.taskDescription) {
                        vscode.commands.executeCommand('pilotflow.generateUserStories', data.taskDescription);
                    }
                    break;
                case 'generateAllUserStories':
                    vscode.commands.executeCommand('pilotflow.generateAllUserStories');
                    break;
                case 'viewLogs':
                    vscode.commands.executeCommand('pilotflow.viewLogs');
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
                    break;
            }
        });

        log('Sidebar webview resolved');
    }

    /**
     * Open PRD.md file in editor
     */
    private async _openPrdFile(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) { return; }

        const prdPath = vscode.Uri.joinPath(workspaceFolder.uri, 'PRD.md');
        try {
            const doc = await vscode.workspace.openTextDocument(prdPath);
            await vscode.window.showTextDocument(doc);
        } catch {
            vscode.window.showWarningMessage('PRD.md not found. Generate one first.');
        }
    }

    // IPilotFlowUI implementation

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
    <title>PilotFlow</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            padding: 12px;
            line-height: 1.4;
        }

        /* ===== ANIMATIONS ===== */
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-3px); }
        }
        @keyframes glow {
            0%, 100% { box-shadow: 0 0 5px rgba(var(--glow-color), 0.3); }
            50% { box-shadow: 0 0 15px rgba(var(--glow-color), 0.6); }
        }
        @keyframes slideIn {
            from { opacity: 0; transform: translateX(-10px); }
            to { opacity: 1; transform: translateX(0); }
        }
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        @keyframes progress {
            0% { background-position: 0% 50%; }
            100% { background-position: 100% 50%; }
        }
        @keyframes ripple {
            0% { transform: scale(1); opacity: 0.4; }
            100% { transform: scale(1.5); opacity: 0; }
        }

        /* ===== HEADER ===== */
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .header h2 {
            font-size: 15px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .header-icon {
            font-size: 18px;
            animation: bounce 2s ease-in-out infinite;
        }
        .header.running .header-icon {
            animation: spin 2s linear infinite;
        }
        .header.waiting .header-icon {
            animation: pulse 1.5s ease-in-out infinite;
        }

        /* ===== STATUS BADGE ===== */
        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            transition: all 0.3s ease;
        }
        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: currentColor;
        }
        .status-idle {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }
        .status-idle .status-dot {
            background: var(--vscode-descriptionForeground);
        }
        .status-running {
            background: linear-gradient(135deg, #10b981, #059669);
            color: white;
            --glow-color: 16, 185, 129;
            animation: glow 2s ease-in-out infinite;
        }
        .status-running .status-dot {
            animation: pulse 1s ease-in-out infinite;
        }
        .status-waiting {
            background: linear-gradient(135deg, #f59e0b, #d97706);
            color: white;
            --glow-color: 245, 158, 11;
            animation: glow 1.5s ease-in-out infinite;
        }
        .status-waiting .status-dot {
            animation: pulse 0.8s ease-in-out infinite;
        }
        .status-paused {
            background: linear-gradient(135deg, #6366f1, #4f46e5);
            color: white;
        }

        /* ===== SECTIONS ===== */
        .section {
            margin-bottom: 16px;
            animation: fadeIn 0.3s ease;
        }
        .section-title {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 8px;
            letter-spacing: 0.5px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .section-title-links {
            display: flex;
            gap: 8px;
        }

        /* ===== STATS GRID ===== */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
        }
        .stat-box {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 12px 8px;
            text-align: center;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }
        .stat-box:hover {
            border-color: var(--vscode-focusBorder);
            transform: translateY(-1px);
        }
        .stat-box.highlight {
            border-color: var(--vscode-charts-green);
        }
        .stat-box.highlight::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: linear-gradient(90deg, var(--vscode-charts-green), var(--vscode-charts-blue));
        }
        .stat-value {
            font-size: 22px;
            font-weight: 700;
            color: var(--vscode-foreground);
            line-height: 1;
        }
        .stat-label {
            font-size: 9px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            margin-top: 4px;
            letter-spacing: 0.5px;
        }

        /* ===== PROGRESS BAR ===== */
        .progress-container {
            margin-top: 12px;
        }
        .progress-bar {
            height: 6px;
            background: var(--vscode-progressBar-background);
            border-radius: 3px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, var(--vscode-charts-green), var(--vscode-charts-blue));
            border-radius: 3px;
            transition: width 0.5s ease;
        }
        .progress-fill.animated {
            background: linear-gradient(90deg, var(--vscode-charts-green), var(--vscode-charts-blue), var(--vscode-charts-green));
            background-size: 200% 100%;
            animation: progress 2s linear infinite;
        }

        /* ===== ELAPSED TIME ===== */
        .elapsed-container {
            background: linear-gradient(135deg, var(--vscode-editor-background), var(--vscode-input-background));
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 12px;
            text-align: center;
            position: relative;
            overflow: hidden;
        }
        .elapsed-container::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.05), transparent);
            animation: shimmer 2s infinite;
        }
        @keyframes shimmer {
            100% { left: 100%; }
        }
        .elapsed-label {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            margin-bottom: 4px;
        }
        .elapsed-time {
            font-size: 28px;
            font-weight: 700;
            font-family: 'Consolas', 'Monaco', monospace;
            letter-spacing: 2px;
        }

        /* ===== COUNTDOWN ===== */
        .countdown {
            text-align: center;
            padding: 16px;
            background: linear-gradient(135deg, var(--vscode-inputValidation-infoBackground), rgba(0,100,200,0.1));
            border: 1px solid var(--vscode-inputValidation-infoBorder);
            border-radius: 8px;
            display: none;
            position: relative;
        }
        .countdown.visible {
            display: block;
            animation: fadeIn 0.3s ease;
        }
        .countdown-value {
            font-size: 36px;
            font-weight: 700;
            font-family: 'Consolas', 'Monaco', monospace;
            position: relative;
        }
        .countdown-ring {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 60px;
            height: 60px;
            border: 3px solid var(--vscode-focusBorder);
            border-radius: 50%;
            opacity: 0;
            animation: ripple 1s ease-out infinite;
        }
        .countdown-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        }

        /* ===== CURRENT TASK ===== */
        .current-task {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 12px;
            position: relative;
            overflow: hidden;
        }
        .current-task.active {
            border-color: var(--vscode-charts-yellow);
        }
        .current-task.active::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: linear-gradient(90deg, var(--vscode-charts-yellow), var(--vscode-charts-orange));
        }
        .current-task-label {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            margin-bottom: 6px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .current-task-label .spinner {
            width: 10px;
            height: 10px;
            border: 2px solid var(--vscode-charts-yellow);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        .current-task-text {
            font-size: 12px;
            word-break: break-word;
            line-height: 1.5;
        }

        /* ===== BUTTONS ===== */
        .buttons {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .btn-row {
            display: flex;
            gap: 8px;
        }
        button {
            flex: 1;
            padding: 10px 14px;
            border: none;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all 0.2s ease;
            position: relative;
            overflow: hidden;
        }
        button::before {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            width: 0;
            height: 0;
            background: rgba(255,255,255,0.2);
            border-radius: 50%;
            transform: translate(-50%, -50%);
            transition: width 0.3s, height 0.3s;
        }
        button:hover::before {
            width: 150%;
            height: 150%;
        }
        button:hover {
            transform: translateY(-1px);
        }
        button:active {
            transform: translateY(0);
        }
        button:disabled {
            opacity: 0.4;
            cursor: not-allowed;
            transform: none;
        }
        button:disabled::before {
            display: none;
        }
        .btn-primary {
            background: linear-gradient(135deg, var(--vscode-button-background), var(--vscode-button-hoverBackground));
            color: var(--vscode-button-foreground);
        }
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn-danger {
            background: linear-gradient(135deg, #ef4444, #dc2626);
            color: white;
        }
        .btn-success {
            background: linear-gradient(135deg, #10b981, #059669);
            color: white;
        }

        /* ===== TASK LIST ===== */
        .task-list {
            max-height: 220px;
            overflow-y: auto;
            padding-right: 4px;
        }
        .task-list::-webkit-scrollbar {
            width: 6px;
        }
        .task-list::-webkit-scrollbar-track {
            background: transparent;
        }
        .task-list::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-background);
            border-radius: 3px;
        }
        .task-item {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 8px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
            font-size: 12px;
            animation: slideIn 0.3s ease;
        }
        .task-item:last-child {
            border-bottom: none;
        }
        .task-item:hover {
            background: rgba(255,255,255,0.02);
            margin: 0 -4px;
            padding-left: 4px;
            padding-right: 4px;
            border-radius: 4px;
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
            margin-top: 1px;
            font-size: 10px;
            transition: all 0.2s ease;
        }
        .task-checkbox.completed {
            background: linear-gradient(135deg, #10b981, #059669);
            border-color: #10b981;
            color: white;
        }
        .task-checkbox.blocked {
            background: linear-gradient(135deg, #ef4444, #dc2626);
            border-color: #ef4444;
            color: white;
        }
        .task-checkbox.in-progress {
            background: linear-gradient(135deg, #f59e0b, #d97706);
            border-color: #f59e0b;
            color: white;
            animation: pulse 1.5s ease-in-out infinite;
        }
        .task-text {
            flex: 1;
            word-break: break-word;
            line-height: 1.4;
        }
        .task-text.completed {
            text-decoration: line-through;
            opacity: 0.6;
        }
        .task-actions {
            display: flex;
            gap: 4px;
            flex-shrink: 0;
        }
        .task-action-btn {
            padding: 4px 8px;
            font-size: 10px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            white-space: nowrap;
            transition: all 0.2s ease;
            font-weight: 500;
        }
        .task-action-btn:hover {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            transform: scale(1.05);
        }
        .task-action-btn.has-stories {
            background: linear-gradient(135deg, #10b981, #059669);
            color: white;
            cursor: default;
        }
        .task-action-btn.has-stories:hover {
            transform: none;
        }

        /* ===== LOGS ===== */
        .logs-container {
            max-height: 150px;
            overflow-y: auto;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 10px;
            font-family: 'Consolas', 'Monaco', var(--vscode-editor-font-family), monospace;
            font-size: 11px;
        }
        .logs-container::-webkit-scrollbar {
            width: 6px;
        }
        .logs-container::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-background);
            border-radius: 3px;
        }
        .log-entry {
            padding: 3px 0;
            word-break: break-word;
            border-left: 2px solid transparent;
            padding-left: 8px;
            margin-left: -8px;
            animation: slideIn 0.2s ease;
        }
        .log-entry.highlight {
            color: #10b981;
            font-weight: 600;
            border-left-color: #10b981;
            background: rgba(16, 185, 129, 0.1);
        }
        .log-entry.error {
            color: #ef4444;
            border-left-color: #ef4444;
        }
        .log-entry.warning {
            color: #f59e0b;
            border-left-color: #f59e0b;
        }

        /* ===== EMPTY STATE ===== */
        .empty-state {
            text-align: center;
            padding: 24px;
            color: var(--vscode-descriptionForeground);
        }
        .empty-state-icon {
            font-size: 40px;
            margin-bottom: 12px;
            opacity: 0.7;
        }
        .empty-state-text {
            margin-bottom: 8px;
        }

        /* ===== LINKS ===== */
        .link {
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            text-decoration: none;
            font-size: 11px;
            transition: opacity 0.2s;
        }
        .link:hover {
            text-decoration: underline;
            opacity: 0.8;
        }

        /* ===== UTILITY ===== */
        .hidden {
            display: none !important;
        }
        .divider {
            height: 1px;
            background: var(--vscode-panel-border);
            margin: 16px 0;
        }
    </style>
</head>
<body>
    <div id="header" class="header">
        <h2><span class="header-icon">🚀</span> PilotFlow</h2>
        <span id="statusBadge" class="status-badge status-idle">
            <span class="status-dot"></span>
            <span id="statusText">Idle</span>
        </span>
    </div>

    <div class="section">
        <div class="section-title">Progress</div>
        <div class="stats-grid">
            <div class="stat-box" id="doneBox">
                <div class="stat-value" id="completedCount">0</div>
                <div class="stat-label">Done</div>
            </div>
            <div class="stat-box">
                <div class="stat-value" id="pendingCount">0</div>
                <div class="stat-label">Pending</div>
            </div>
            <div class="stat-box">
                <div class="stat-value" id="iterationCount">0</div>
                <div class="stat-label">Iteration</div>
            </div>
        </div>
        <div id="progressContainer" class="progress-container hidden">
            <div class="progress-bar">
                <div id="progressFill" class="progress-fill" style="width: 0%"></div>
            </div>
        </div>
    </div>

    <div id="elapsedSection" class="section hidden">
        <div class="elapsed-container">
            <div class="elapsed-label">⏱️ Elapsed Time</div>
            <div id="elapsedTime" class="elapsed-time">00:00:00</div>
        </div>
    </div>

    <div id="countdownSection" class="section countdown">
        <div class="countdown-ring"></div>
        <div class="countdown-value" id="countdownValue">0</div>
        <div class="countdown-label">seconds until next task</div>
    </div>

    <div id="currentTaskSection" class="section hidden">
        <div id="currentTaskBox" class="current-task">
            <div class="current-task-label">
                <span class="spinner"></span>
                Working On
            </div>
            <div class="current-task-text" id="currentTaskText"></div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Controls</div>
        <div class="buttons">
            <div class="btn-row">
                <button id="btnStart" class="btn-primary">
                    ▶️ Start
                </button>
                <button id="btnStop" class="btn-danger" disabled>
                    ⏹️ Stop
                </button>
            </div>
            <div class="btn-row">
                <button id="btnPause" class="btn-secondary" disabled>
                    ⏸️ Pause
                </button>
                <button id="btnResume" class="btn-success" disabled>
                    ▶️ Resume
                </button>
            </div>
            <div class="btn-row">
                <button id="btnNext" class="btn-secondary">
                    ⏭️ Single Step
                </button>
                <button id="btnGenerate" class="btn-secondary">
                    📝 Generate PRD
                </button>
            </div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">
            <span>Tasks</span>
            <div class="section-title-links">
                <span id="generateAllStoriesLink" class="link">[Gen All Stories]</span>
                <span id="openPrdLink" class="link">[Open PRD]</span>
            </div>
        </div>
        <div id="taskList" class="task-list">
            <div class="empty-state">
                <div class="empty-state-icon">📋</div>
                <div class="empty-state-text">No PRD found</div>
                <div id="generatePrdLink" class="link">Generate one →</div>
            </div>
        </div>
    </div>

    <div class="section" id="userStoriesSection">
        <div class="section-title">User Stories</div>
        <div id="userStoriesList" class="task-list">
            <div class="empty-state" style="padding: 12px;">No user stories yet</div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">
            <span>Activity Log</span>
            <span id="viewLogsLink" class="link">[Full Logs]</span>
        </div>
        <div id="logsContainer" class="logs-container">
            <div class="empty-state" style="padding: 12px;">Waiting for activity...</div>
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
            countdown: 0,
            sessionStartTime: 0,
            stats: { total: 0, completed: 0, pending: 0 },
            tasks: [],
            userStories: [],
            logs: []
        };

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
            // Header and status badge with animations
            const header = document.getElementById('header');
            const badge = document.getElementById('statusBadge');
            const statusTextEl = document.getElementById('statusText');
            
            // Update header class for animation
            header.className = 'header ' + state.status;
            
            badge.className = 'status-badge status-' + state.status;
            const statusText = {
                'idle': 'Idle',
                'running': 'Running',
                'waiting': 'Waiting',
                'paused': 'Paused'
            };
            statusTextEl.textContent = state.iteration > 0 && state.status !== 'idle' 
                ? statusText[state.status] + ' #' + state.iteration 
                : statusText[state.status] || state.status;

            // Stats
            const completedEl = document.getElementById('completedCount');
            const prevCompleted = parseInt(completedEl.textContent) || 0;
            const newCompleted = state.stats.completed || 0;
            completedEl.textContent = newCompleted;
            
            // Highlight done box when count increases
            const doneBox = document.getElementById('doneBox');
            if (newCompleted > prevCompleted) {
                doneBox.classList.add('highlight');
                setTimeout(() => doneBox.classList.remove('highlight'), 2000);
            }
            
            document.getElementById('pendingCount').textContent = state.stats.pending || 0;
            document.getElementById('iterationCount').textContent = state.iteration;

            // Progress bar
            const progressContainer = document.getElementById('progressContainer');
            const progressFill = document.getElementById('progressFill');
            const total = (state.stats.completed || 0) + (state.stats.pending || 0);
            if (total > 0) {
                progressContainer.classList.remove('hidden');
                const percentage = Math.round((state.stats.completed / total) * 100);
                progressFill.style.width = percentage + '%';
                progressFill.classList.toggle('animated', state.status === 'running' || state.status === 'waiting');
            } else {
                progressContainer.classList.add('hidden');
            }

            // Elapsed time
            const elapsedSection = document.getElementById('elapsedSection');
            const isActive = state.status === 'running' || state.status === 'waiting' || state.status === 'paused';
            if (isActive && state.sessionStartTime > 0) {
                elapsedSection.classList.remove('hidden');
                startElapsedTimer();
            } else {
                elapsedSection.classList.add('hidden');
                stopElapsedTimer();
            }

            // Countdown
            const countdownSection = document.getElementById('countdownSection');
            if (state.countdown > 0) {
                countdownSection.classList.add('visible');
                document.getElementById('countdownValue').textContent = state.countdown;
            } else {
                countdownSection.classList.remove('visible');
            }

            // Current task
            const currentTaskSection = document.getElementById('currentTaskSection');
            const currentTaskBox = document.getElementById('currentTaskBox');
            if (state.currentTask && (state.status === 'running' || state.status === 'waiting')) {
                currentTaskSection.classList.remove('hidden');
                currentTaskBox.classList.add('active');
                document.getElementById('currentTaskText').textContent = state.currentTask;
            } else {
                currentTaskSection.classList.add('hidden');
                currentTaskBox.classList.remove('active');
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
                container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">No PRD found</div><div id="generatePrdLinkEmpty" class="link">Generate one →</div></div>';
                if (genAllLink) { genAllLink.style.display = 'none'; }
                // Re-attach event listener for dynamically created link
                const link = document.getElementById('generatePrdLinkEmpty');
                if (link) {
                    link.addEventListener('click', () => send('generatePrd'));
                }
                return;
            }

            // Show/hide generate all stories link based on whether any tasks need stories
            const tasksNeedingStories = state.tasks.filter(t => !t.hasUserStories && t.status !== 'COMPLETE');
            if (genAllLink) {
                genAllLink.style.display = tasksNeedingStories.length > 0 ? 'inline' : 'none';
            }

            const isActive = state.status === 'running' || state.status === 'waiting';

            const html = state.tasks.map((task, index) => {
                let checkboxClass = 'task-checkbox';
                let textClass = 'task-text';
                let icon = '';
                
                // Check if this task is the current one being worked on
                // Use activeTaskDescription which always contains the parent task
                const isCurrentTask = isActive && state.activeTaskDescription && 
                    task.description === state.activeTaskDescription;
                
                if (isCurrentTask && task.status !== 'COMPLETE') {
                    // Override to show as in-progress
                    checkboxClass += ' in-progress';
                    icon = '~';
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
                            icon = '~';
                            break;
                        default:
                            icon = '';
                    }
                }

                // Generate story button - show for pending tasks without stories
                let actionBtn = '';
                if (task.status !== 'COMPLETE') {
                    if (task.hasUserStories) {
                        actionBtn = '<span class="task-action-btn has-stories" title="User stories exist">✓ Stories</span>';
                    } else {
                        actionBtn = '<button class="task-action-btn" data-task-index="' + index + '" title="Generate user stories for this task">+ Stories</button>';
                    }
                }

                return '<div class="task-item"><div class="' + checkboxClass + '">' + icon + '</div><div class="' + textClass + '">' + escapeHtml(task.description) + '</div><div class="task-actions">' + actionBtn + '</div></div>';
            }).join('');

            container.innerHTML = html;

            // Attach event listeners to story generation buttons
            container.querySelectorAll('.task-action-btn:not(.has-stories)').forEach(btn => {
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
            const section = document.getElementById('userStoriesSection');
            
            if (!state.userStories || state.userStories.length === 0) {
                section.style.display = 'none';
                return;
            }
            
            section.style.display = 'block';

            // Group user stories by task
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
                html += '<div class="task-group">';
                html += '<div class="task-group-header" style="font-size: 10px; color: var(--vscode-descriptionForeground); margin: 8px 0 4px 0;">' + escapeHtml(taskId) + ' (' + completed + '/' + stories.length + ')</div>';
                
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
                            icon = '~';
                            break;
                        default:
                            icon = '';
                    }

                    html += '<div class="task-item"><div class="' + checkboxClass + '">' + icon + '</div><div class="' + textClass + '">' + escapeHtml(story.description) + '</div></div>';
                });
                
                html += '</div>';
            }

            container.innerHTML = html;
        }

        function renderLogs() {
            const container = document.getElementById('logsContainer');
            
            if (!state.logs || state.logs.length === 0) {
                container.innerHTML = '<div class="empty-state" style="padding: 12px;">Waiting for activity...</div>';
                return;
            }

            const html = state.logs.slice(-25).map(log => {
                const isHighlight = log.startsWith('⭐');
                const isError = log.includes('Error') || log.includes('Failed') || log.includes('❌');
                const isWarning = log.includes('⚠️') || log.includes('Warning');
                let className = 'log-entry';
                if (isHighlight) className += ' highlight';
                if (isError) className += ' error';
                if (isWarning) className += ' warning';
                return '<div class="' + className + '">' + escapeHtml(log) + '</div>';
            }).join('');

            container.innerHTML = html;
            container.scrollTop = container.scrollHeight;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            if (message.type === 'fullState' || message.type === 'update') {
                state.status = message.status || state.status;
                state.iteration = message.iteration || 0;
                state.currentTask = message.currentTask || '';
                state.activeTaskDescription = message.activeTaskDescription || state.activeTaskDescription;
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
        });

        // Initial render and notify ready
        updateUI();
        
        // Add event listeners for buttons
        document.getElementById('btnStart').addEventListener('click', () => send('start'));
        document.getElementById('btnStop').addEventListener('click', () => send('stop'));
        document.getElementById('btnPause').addEventListener('click', () => send('pause'));
        document.getElementById('btnResume').addEventListener('click', () => send('resume'));
        document.getElementById('btnNext').addEventListener('click', () => send('next'));
        document.getElementById('btnGenerate').addEventListener('click', () => send('generatePrd'));
        document.getElementById('openPrdLink').addEventListener('click', () => send('openPrd'));
        document.getElementById('viewLogsLink').addEventListener('click', () => send('viewLogs'));
        
        // For the generate link in task list (if it exists on initial load)
        const generateLink = document.getElementById('generatePrdLink');
        if (generateLink) {
            generateLink.addEventListener('click', () => send('generatePrd'));
        }

        // For the generate all stories link
        const generateAllStoriesLink = document.getElementById('generateAllStoriesLink');
        if (generateAllStoriesLink) {
            generateAllStoriesLink.addEventListener('click', () => send('generateAllUserStories'));
        }
        
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
