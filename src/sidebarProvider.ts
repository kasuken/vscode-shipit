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
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .header h2 {
            font-size: 14px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 11px;
            font-weight: 500;
        }
        .status-idle {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }
        .status-running {
            background: var(--vscode-charts-green);
            color: white;
        }
        .status-waiting {
            background: var(--vscode-charts-yellow);
            color: black;
        }
        .status-paused {
            background: var(--vscode-charts-orange);
            color: white;
        }
        .section {
            margin-bottom: 16px;
        }
        .section-title {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 8px;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
        }
        .stat-box {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 8px;
            text-align: center;
        }
        .stat-value {
            font-size: 18px;
            font-weight: 600;
            color: var(--vscode-foreground);
        }
        .stat-label {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
        }
        .current-task {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 10px;
        }
        .current-task-label {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            margin-bottom: 4px;
        }
        .current-task-text {
            font-size: 12px;
            word-break: break-word;
        }
        .countdown {
            text-align: center;
            padding: 12px;
            background: var(--vscode-inputValidation-infoBackground);
            border: 1px solid var(--vscode-inputValidation-infoBorder);
            border-radius: 4px;
            display: none;
        }
        .countdown.visible {
            display: block;
        }
        .countdown-value {
            font-size: 24px;
            font-weight: bold;
        }
        .countdown-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        .buttons {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .btn-row {
            display: flex;
            gap: 6px;
        }
        button {
            flex: 1;
            padding: 8px 12px;
            border: none;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            transition: opacity 0.2s;
        }
        button:hover {
            opacity: 0.9;
        }
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn-danger {
            background: var(--vscode-errorForeground);
            color: white;
        }
        .task-list {
            max-height: 200px;
            overflow-y: auto;
        }
        .task-item {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            padding: 6px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
            font-size: 12px;
        }
        .task-item:last-child {
            border-bottom: none;
        }
        .task-checkbox {
            width: 14px;
            height: 14px;
            border: 1px solid var(--vscode-checkbox-border);
            border-radius: 3px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            margin-top: 2px;
        }
        .task-checkbox.completed {
            background: var(--vscode-charts-green);
            border-color: var(--vscode-charts-green);
        }
        .task-checkbox.blocked {
            background: var(--vscode-errorForeground);
            border-color: var(--vscode-errorForeground);
        }
        .task-checkbox.in-progress {
            background: var(--vscode-charts-yellow);
            border-color: var(--vscode-charts-yellow);
        }
        .task-text {
            flex: 1;
            word-break: break-word;
        }
        .task-text.completed {
            text-decoration: line-through;
            opacity: 0.7;
        }
        .logs-container {
            max-height: 150px;
            overflow-y: auto;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 8px;
            font-family: var(--vscode-editor-font-family);
            font-size: 11px;
        }
        .log-entry {
            padding: 2px 0;
            word-break: break-word;
        }
        .log-entry.highlight {
            color: var(--vscode-charts-green);
            font-weight: 500;
        }
        .empty-state {
            text-align: center;
            padding: 20px;
            color: var(--vscode-descriptionForeground);
        }
        .empty-state-icon {
            font-size: 32px;
            margin-bottom: 8px;
        }
        .link {
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            text-decoration: underline;
        }
        .hidden {
            display: none !important;
        }
    </style>
</head>
<body>
    <div class="header">
        <h2>🚀 PilotFlow</h2>
        <span id="statusBadge" class="status-badge status-idle">Idle</span>
    </div>

    <div class="section">
        <div class="section-title">Progress</div>
        <div class="stats-grid">
            <div class="stat-box">
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
    </div>

    <div id="countdownSection" class="section countdown">
        <div class="countdown-value" id="countdownValue">0</div>
        <div class="countdown-label">Next task in seconds</div>
    </div>

    <div id="currentTaskSection" class="section hidden">
        <div class="current-task">
            <div class="current-task-label">Current Task</div>
            <div class="current-task-text" id="currentTaskText"></div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Controls</div>
        <div class="buttons">
            <div class="btn-row">
                <button id="btnStart" class="btn-primary">
                    ▶ Start
                </button>
                <button id="btnStop" class="btn-danger" disabled>
                    ⏹ Stop
                </button>
            </div>
            <div class="btn-row">
                <button id="btnPause" class="btn-secondary" disabled>
                    ⏸ Pause
                </button>
                <button id="btnResume" class="btn-secondary" disabled>
                    ▶ Resume
                </button>
            </div>
            <div class="btn-row">
                <button id="btnNext" class="btn-secondary">
                    ⏭ Single Step
                </button>
                <button id="btnGenerate" class="btn-secondary">
    </div>

    <div class="section">
        <div class="section-title">
            Tasks 
            <span id="openPrdLink" class="link" style="float: right; font-weight: normal;">[Open PRD]</span>
        </div>
        <div id="taskList" class="task-list">
            <div class="empty-state">
                <div class="empty-state-icon">📋</div>
                <div>No PRD found</div>
                <div id="generatePrdLink" class="link">Generate one</div>
            </div>
        </div>
    </div>

    <div class="section" id="userStoriesSection">
        <div class="section-title">User Stories</div>
        <div id="userStoriesList" class="task-list">
            <div class="empty-state" style="padding: 10px;">No user stories yet</div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">
            Activity Log
            <span id="viewLogsLink" class="link" style="float: right; font-weight: normal;">[Full Logs]</span>
        </div>
        <div id="logsContainer" class="logs-container">
            <div class="empty-state" style="padding: 10px;">No activity yet</div>
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
            countdown: 0,
            stats: { total: 0, completed: 0, pending: 0 },
            tasks: [],
            userStories: [],
            logs: []
        };

        // Update UI based on state
        function updateUI() {
            // Status badge
            const badge = document.getElementById('statusBadge');
            badge.className = 'status-badge status-' + state.status;
            const statusText = {
                'idle': 'Idle',
                'running': 'Running #' + state.iteration,
                'waiting': 'Waiting',
                'paused': 'Paused'
            };
            badge.textContent = statusText[state.status] || state.status;

            // Stats
            document.getElementById('completedCount').textContent = state.stats.completed || 0;
            document.getElementById('pendingCount').textContent = state.stats.pending || 0;
            document.getElementById('iterationCount').textContent = state.iteration;

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
            if (state.currentTask && (state.status === 'running' || state.status === 'waiting')) {
                currentTaskSection.classList.remove('hidden');
                document.getElementById('currentTaskText').textContent = state.currentTask;
            } else {
                currentTaskSection.classList.add('hidden');
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
            
            if (!state.tasks || state.tasks.length === 0) {
                container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><div>No PRD found</div><div id="generatePrdLinkEmpty" class="link">Generate one</div></div>';
                // Re-attach event listener for dynamically created link
                const link = document.getElementById('generatePrdLinkEmpty');
                if (link) {
                    link.addEventListener('click', () => send('generatePrd'));
                }
                return;
            }

            const isActive = state.status === 'running' || state.status === 'waiting';

            const html = state.tasks.map(task => {
                let checkboxClass = 'task-checkbox';
                let textClass = 'task-text';
                let icon = '';
                
                // Check if this task is the current one being worked on
                const isCurrentTask = isActive && state.currentTask && task.description === state.currentTask;
                
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

                return '<div class="task-item"><div class="' + checkboxClass + '">' + icon + '</div><div class="' + textClass + '">' + escapeHtml(task.description) + '</div></div>';
            }).join('');

            container.innerHTML = html;
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
                container.innerHTML = '<div class="empty-state" style="padding: 10px;">No activity yet</div>';
                return;
            }

            const html = state.logs.slice(-20).map(log => {
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

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            if (message.type === 'fullState' || message.type === 'update') {
                state.status = message.status || state.status;
                state.iteration = message.iteration || 0;
                state.currentTask = message.currentTask || '';
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
