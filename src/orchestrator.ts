import * as vscode from 'vscode';
import {
    LoopExecutionState,
    TaskRequirements,
    PilotFlowSettings,
    REVIEW_COUNTDOWN_SECONDS,
    IPilotFlowUI
} from './types';
import { logError } from './logger';
import { 
    readPRDAsync, 
    getNextTaskAsync, 
    getTaskStatsAsync, 
    getWorkspaceRoot, 
    appendProgressAsync, 
    ensureProgressFileAsync,
    hasUserStoriesForTaskAsync,
    getNextUserStoryAsync,
    areAllUserStoriesCompleteAsync,
    getUserStoryStatsAsync,
    readUserStoriesAsync,
    getAllTasksAsync
} from './fileUtils';
import { PilotFlowStatusBar } from './statusBar';
import { CountdownTimer, InactivityMonitor } from './timerManager';
import { FileWatcherManager } from './fileWatchers';
import { UIManager } from './uiManager';
import { TaskRunner } from './taskRunner';

/**
 * Main orchestrator for the PilotFlow loop
 */
export class LoopOrchestrator {
    private state: LoopExecutionState = LoopExecutionState.IDLE;
    private isPaused = false;
    private sessionStartTime = 0;
    
    // User story workflow state
    private currentTaskId = '';
    private currentTaskDescription = '';
    private isGeneratingUserStories = false;
    private isImplementingUserStory = false;
    private currentUserStoryDescription = '';

    private readonly ui: UIManager;
    private readonly taskRunner: TaskRunner;
    private readonly fileWatchers = new FileWatcherManager();
    private readonly countdownTimer = new CountdownTimer();
    private readonly inactivityMonitor = new InactivityMonitor();

    constructor(statusBar: PilotFlowStatusBar) {
        this.ui = new UIManager(statusBar);
        this.taskRunner = new TaskRunner();

        this.taskRunner.setLogCallback((message, highlight) => {
            this.ui.addLog(message, highlight);
        });
    }

    /**
     * Set the main panel for UI updates
     */
    setPanel(panel: IPilotFlowUI | null): void {
        this.ui.setPanel(panel);
    }

    /**
     * Set the sidebar view for UI updates
     */
    setSidebarView(view: IPilotFlowUI): void {
        this.ui.setSidebarView(view);
    }

    /**
     * Set task requirements
     */
    setRequirements(requirements: TaskRequirements): void {
        this.taskRunner.setRequirements(requirements);
    }

    /**
     * Get current requirements
     */
    getRequirements(): TaskRequirements {
        return this.taskRunner.getRequirements();
    }

    /**
     * Set settings
     */
    setSettings(settings: PilotFlowSettings): void {
        this.taskRunner.setSettings(settings);
    }

    /**
     * Get current settings
     */
    getSettings(): PilotFlowSettings {
        return this.taskRunner.getSettings();
    }

    /**
     * Start the execution loop
     */
    async startLoop(): Promise<void> {
        if (this.state === LoopExecutionState.RUNNING) {
            this.ui.addLog('Loop is already running');
            return;
        }

        // Start the Copilot SDK service
        const copilotStarted = await this.taskRunner.startCopilotService();
        if (!copilotStarted) {
            this.ui.addLog('Failed to start Copilot SDK service. Please ensure Copilot CLI is installed.');
            return;
        }

        const stats = await getTaskStatsAsync();
        if (stats.pending === 0) {
            this.ui.addLog('No pending tasks found. Add tasks to PRD.md first.');
            vscode.window.showInformationMessage('PilotFlow: No pending tasks found in PRD.md');
            return;
        }

        // Ensure progress.txt exists
        await ensureProgressFileAsync();

        this.taskRunner.clearHistory();
        this.ui.clearLogs();
        this.ui.updateHistory([]);

        this.state = LoopExecutionState.RUNNING;
        this.isPaused = false;
        this.taskRunner.resetIterations();
        this.sessionStartTime = Date.now();

        await this.ui.updateStats();

        this.ui.addLog('🚀 Starting PilotFlow loop...');
        await this.updatePanelTiming();
        this.ui.updateStatus('running', this.taskRunner.getIterationCount(), this.taskRunner.getCurrentTask());

        await this.setupWatchers();
        await this.runNextTask();
    }

    /**
     * Pause the loop
     */
    pauseLoop(): void {
        if (this.state !== LoopExecutionState.RUNNING) { return; }

        this.isPaused = true;
        this.fileWatchers.prdWatcher.disable();
        this.inactivityMonitor.pause();
        this.countdownTimer.stop();

        this.ui.addLog('Loop paused');
        this.ui.updateStatus('paused', this.taskRunner.getIterationCount(), this.taskRunner.getCurrentTask());
    }

    /**
     * Resume the loop
     */
    resumeLoop(): void {
        if (!this.isPaused) { return; }

        this.isPaused = false;
        this.inactivityMonitor.resume();
        this.ui.addLog('Loop resumed');
        this.ui.updateStatus('running', this.taskRunner.getIterationCount(), this.taskRunner.getCurrentTask());

        this.runNextTask();
    }

    /**
     * Stop the loop
     */
    async stopLoop(): Promise<void> {
        this.fileWatchers.dispose();
        this.countdownTimer.stop();
        this.inactivityMonitor.stop();
        this.stopPrdCompletionCheck();

        // Abort any current Copilot operation
        await this.taskRunner.abortCopilot();

        this.state = LoopExecutionState.IDLE;
        this.isPaused = false;
        this.currentTaskDescription = '';
        this.currentTaskId = '';

        this.ui.setActiveTask('');
        this.ui.updateStatus('idle', this.taskRunner.getIterationCount(), this.taskRunner.getCurrentTask());
        this.ui.updateCountdown(0);
        this.ui.updateSessionTiming(0, this.taskRunner.getTaskHistory(), 0);
        await this.ui.updateStats();
    }

    /**
     * Run a single step (one task)
     */
    async runSingleStep(): Promise<void> {
        if (this.state === LoopExecutionState.RUNNING) {
            this.ui.addLog('Cannot run single step while loop is running');
            return;
        }

        const task = await getNextTaskAsync();
        if (!task) {
            this.ui.addLog('No pending tasks');
            vscode.window.showInformationMessage('PilotFlow: No pending tasks in PRD.md');
            return;
        }

        if (this.taskRunner.checkIterationLimit()) { return; }

        this.taskRunner.incrementIteration();
        this.taskRunner.setCurrentTask(task.description);
        this.ui.addLog(`Single step: ${task.description}`);
        await this.taskRunner.triggerCopilotAgent(task.description);
    }

    /**
     * Generate a PRD from a description
     */
    async generatePrdFromDescription(taskDescription: string): Promise<void> {
        const root = getWorkspaceRoot();
        if (!root) {
            vscode.window.showErrorMessage('PilotFlow: No workspace folder open');
            return;
        }

        this.ui.showPrdGenerating();
        this.setupPrdCreationWatcher();
        await this.taskRunner.triggerPrdGeneration(taskDescription);
    }

    /**
     * Generate user stories for a specific task (on-demand)
     */
    async generateUserStoriesForTask(taskDescription: string): Promise<void> {
        const root = getWorkspaceRoot();
        if (!root) {
            vscode.window.showErrorMessage('PilotFlow: No workspace folder open');
            return;
        }

        // Check if stories already exist
        const hasStories = await hasUserStoriesForTaskAsync(taskDescription);
        if (hasStories) {
            vscode.window.showInformationMessage('User stories already exist for this task');
            return;
        }

        // Get task ID from PRD
        const tasks = await getAllTasksAsync();
        const task = tasks.find(t => t.description === taskDescription);
        const taskId = task?.id || `task-${Date.now()}`;

        this.ui.addLog(`📋 Generating user stories for: ${taskDescription}`);
        await this.taskRunner.triggerUserStoriesGeneration(taskDescription, taskId, async () => {
            // Called when generation completes
            this.ui.addLog(`✅ User stories created for: ${taskDescription}`, true);
            await this.ui.refresh();
            vscode.window.showInformationMessage(`User stories created for task: ${taskDescription}`);
        });
        
        this.ui.addLog('⏳ Copilot is generating user stories...');
    }

    /**
     * Set up watcher for single task user stories creation (on-demand)
     */
    private setupSingleUserStoriesWatcher(taskDescription: string): void {
        const root = getWorkspaceRoot();
        if (!root) { return; }

        this.fileWatchers.activityWatcher.start(async () => {
            const hasStories = await hasUserStoriesForTaskAsync(taskDescription);
            if (hasStories) {
                this.ui.addLog(`✅ User stories created for: ${taskDescription}`, true);
                this.fileWatchers.activityWatcher.dispose();
                await this.ui.refresh();
                vscode.window.showInformationMessage(`User stories created for task: ${taskDescription}`);
            }
        });
        this.ui.addLog('👁️ Watching for user stories creation...');
    }

    // Track tasks needing stories for batch generation
    private tasksNeedingStories: { id: string; description: string }[] = [];
    private isGeneratingAllStories = false;

    /**
     * Generate user stories for all pending tasks without stories
     */
    async generateAllUserStories(): Promise<void> {
        const root = getWorkspaceRoot();
        if (!root) {
            vscode.window.showErrorMessage('PilotFlow: No workspace folder open');
            return;
        }

        if (this.isGeneratingAllStories) {
            vscode.window.showInformationMessage('Already generating user stories. Please wait...');
            return;
        }

        const tasks = await getAllTasksAsync();
        const pendingTasks = tasks.filter(t => t.status !== 'COMPLETE');
        
        if (pendingTasks.length === 0) {
            vscode.window.showInformationMessage('No pending tasks found');
            return;
        }

        // Find tasks without user stories
        this.tasksNeedingStories = [];
        for (const task of pendingTasks) {
            const hasStories = await hasUserStoriesForTaskAsync(task.description);
            if (!hasStories) {
                this.tasksNeedingStories.push({ id: task.id, description: task.description });
            }
        }

        if (this.tasksNeedingStories.length === 0) {
            vscode.window.showInformationMessage('All tasks already have user stories');
            return;
        }

        this.isGeneratingAllStories = true;
        this.ui.addLog(`📋 Generating user stories for ${this.tasksNeedingStories.length} task(s)...`);
        
        // Start with the first task
        await this.generateNextBatchStory();
    }

    /**
     * Generate stories for the next task in the batch
     */
    private async generateNextBatchStory(): Promise<void> {
        if (this.tasksNeedingStories.length === 0) {
            this.isGeneratingAllStories = false;
            this.ui.addLog('✅ All user stories generated!', true);
            await this.ui.refresh();
            vscode.window.showInformationMessage('PilotFlow: All user stories generated!');
            return;
        }

        const nextTask = this.tasksNeedingStories[0];
        this.ui.addLog(`📝 Generating stories for: ${nextTask.description} (${this.tasksNeedingStories.length} remaining)`);
        
        await this.taskRunner.triggerUserStoriesGeneration(nextTask.description, nextTask.id, async () => {
            // Called when generation completes
            this.ui.addLog(`✅ User stories created for: ${nextTask.description}`, true);
            await this.ui.refresh();
            
            // Remove from queue and continue with next
            this.tasksNeedingStories = this.tasksNeedingStories.filter(t => t.description !== nextTask.description);
            
            // Wait a moment before starting the next one
            setTimeout(async () => {
                if (this.isGeneratingAllStories) {
                    await this.generateNextBatchStory();
                }
            }, 1000);
        });
        
        this.ui.addLog('⏳ Copilot is generating user stories...');
    }

    /**
     * Set up watcher for batch user stories creation
     */
    private setupBatchUserStoriesWatcher(taskDescription: string): void {
        const root = getWorkspaceRoot();
        if (!root) { return; }

        this.fileWatchers.activityWatcher.start(async () => {
            const hasStories = await hasUserStoriesForTaskAsync(taskDescription);
            if (hasStories) {
                this.ui.addLog(`✅ User stories created for: ${taskDescription}`, true);
                this.fileWatchers.activityWatcher.dispose();
                await this.ui.refresh();
                
                // Remove from queue and continue with next
                this.tasksNeedingStories = this.tasksNeedingStories.filter(t => t.description !== taskDescription);
                
                // Wait a moment before starting the next one
                setTimeout(() => this.generateNextBatchStory(), 2000);
            }
        });
        this.ui.addLog('👁️ Watching for user stories creation...');
    }

    /**
     * Show status in a chat response stream
     */
    async showStatus(stream: vscode.ChatResponseStream): Promise<void> {
        const taskStats = await getTaskStatsAsync();
        const task = await getNextTaskAsync();
        const prd = await readPRDAsync();
        const settings = this.taskRunner.getSettings();

        stream.markdown('## PilotFlow Status\n\n');

        if (!prd) {
            stream.markdown('**No PRD found.** Run `@pilotflow /init` to create template files.\n');
            return;
        }

        stream.markdown(`**State:** ${this.state}\n`);
        stream.markdown(`**Tasks:** ${taskStats.completed}/${taskStats.total} complete\n`);
        stream.markdown(`**Iterations:** ${this.taskRunner.getIterationCount()}${settings.maxIterations > 0 ? ` / ${settings.maxIterations}` : ''}\n\n`);

        if (task) {
            stream.markdown(`**Next Task:** ${task.description}\n`);
        } else if (taskStats.total > 0) {
            stream.markdown('**All tasks completed!**\n');
        }
    }

    /**
     * Dispose resources
     */
    async dispose(): Promise<void> {
        await this.stopLoop();
        await this.taskRunner.stopCopilotService();
    }

    /**
     * Set up file watchers
     */
    private async setupWatchers(): Promise<void> {
        const initialContent = await readPRDAsync() || '';

        this.fileWatchers.prdWatcher.start(initialContent, (newContent) => {
            this.handlePrdChange(newContent);
        });
        this.ui.addLog('👁️ Watching PRD.md for task completion...');

        this.fileWatchers.activityWatcher.start(() => {
            this.inactivityMonitor.recordActivity();
        });

        this.inactivityMonitor.start(() => this.handleInactivity());
    }

    /**
     * Set up watcher for PRD creation
     */
    private setupPrdCreationWatcher(): void {
        this.fileWatchers.prdCreationWatcher.start(async () => {
            this.ui.addLog('PRD.md created successfully!', true);
            await this.ui.refresh();
            this.fileWatchers.prdCreationWatcher.dispose();
            vscode.window.showInformationMessage('PilotFlow: PRD.md created! Click Start to begin.');
        });
        this.ui.addLog('👁️ Watching for PRD.md creation...');
    }

    /**
     * Run the next task in the queue
     */
    private async runNextTask(): Promise<void> {
        if (this.state !== LoopExecutionState.RUNNING || this.isPaused) {
            return;
        }

        const stats = await getTaskStatsAsync();

        if (stats.pending === 0) {
            // Calculate total elapsed time
            const totalElapsedMs = Date.now() - this.sessionStartTime;
            const totalSeconds = Math.floor(totalElapsedMs / 1000);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;
            const formattedTime = `${hours}h ${minutes}m ${seconds}s`;
            
            this.ui.addLog('🎉 All tasks completed!', true);
            this.ui.addLog(`⏱️ Total elapsed time: ${formattedTime}`, true);
            
            // Append total time to progress log
            await appendProgressAsync(`🎉 All tasks completed! Total time: ${formattedTime}`);
            
            this.stopLoop();
            vscode.window.showInformationMessage(`PilotFlow: All PRD tasks completed! 🎉 Total time: ${formattedTime}`);
            return;
        }

        const task = await getNextTaskAsync();
        if (!task) {
            this.ui.addLog('No more tasks to process');
            this.stopLoop();
            return;
        }

        if (this.taskRunner.checkIterationLimit()) {
            this.stopLoop();
            return;
        }

        const iteration = this.taskRunner.incrementIteration();
        this.taskRunner.setCurrentTask(task.description);
        this.currentTaskId = task.id;
        this.currentTaskDescription = task.description;
        this.ui.setIteration(iteration);
        this.ui.setTaskInfo(task.description);
        this.ui.setActiveTask(task.description);
        this.ui.updateStatus('running', iteration, task.description);

        // Check if user stories exist for this task
        const hasStories = await hasUserStoriesForTaskAsync(task.description);
        
        if (!hasStories) {
            // No user stories - generate them automatically
            this.ui.addLog(`📋 Task ${iteration}: ${task.description}`);
            this.ui.addLog('⚠️ No user stories found for this task. Generating user stories...', true);
            
            // Generate stories automatically
            this.isGeneratingUserStories = true;
            this.isImplementingUserStory = false;
            
            await this.taskRunner.triggerUserStoriesGeneration(task.description, task.id, async () => {
                // Called when generation completes
                this.ui.addLog('✅ User stories created', true);
                this.isGeneratingUserStories = false;
                await this.ui.refresh();
                
                // Continue with implementing the stories
                setTimeout(async () => {
                    if (this.state === LoopExecutionState.RUNNING && !this.isPaused) {
                        await this.runNextUserStory();
                    }
                }, 1000);
            });
            
            this.inactivityMonitor.setWaiting(true);
            this.ui.updateStatus('waiting', iteration, `Generating stories for: ${task.description}`);
            this.ui.addLog('Copilot is creating user stories...');
        } else {
            // User stories exist, run the next one
            await this.runNextUserStory();
        }
    }

    /**
     * Run the next user story for the current task
     */
    private async runNextUserStory(): Promise<void> {
        if (this.state !== LoopExecutionState.RUNNING || this.isPaused) {
            return;
        }

        // Check if all user stories for current task are complete
        const allComplete = await areAllUserStoriesCompleteAsync(this.currentTaskDescription);
        
        if (allComplete) {
            this.ui.addLog(`✅ All user stories complete for task: ${this.currentTaskDescription}`, true);
            
            // First check if the task is already marked complete in PRD
            const task = await getNextTaskAsync();
            if (!task || task.description !== this.currentTaskDescription) {
                // Task already marked complete, move to next
                this.ui.addLog('Task already marked complete in PRD.md', true);
                
                const completion = this.taskRunner.recordTaskCompletion();
                await appendProgressAsync(`✅ Completed: ${completion.taskDescription} (took ${Math.round(completion.duration / 1000)}s)`);
                this.ui.updateHistory(this.taskRunner.getTaskHistory());
                
                await this.startCountdown();
                return;
            }
            
            this.ui.addLog('Task is ready to be marked complete in PRD.md');
            
            // Mark the task complete in PRD.md - trigger agent to do this
            await this.taskRunner.triggerCopilotAgent(
                `Mark the following task as complete in PRD.md by changing "- [ ]" to "- [x]": ${this.currentTaskDescription}`
            );
            
            // Refresh PRD content before enabling watcher
            const currentPrdContent = await readPRDAsync() || '';
            this.fileWatchers.prdWatcher.updateContent(currentPrdContent);
            this.fileWatchers.prdWatcher.enable();
            
            this.inactivityMonitor.setWaiting(true);
            this.ui.updateStatus('waiting', this.taskRunner.getIterationCount(), this.currentTaskDescription);
            this.ui.addLog('Waiting for task to be marked complete in PRD.md...');
            
            // Start periodic check as backup for file watcher
            this.startPrdCompletionCheck();
            return;
        }

        const story = await getNextUserStoryAsync(this.currentTaskDescription);
        if (!story) {
            this.ui.addLog('No more user stories to process for this task');
            await this.startCountdown();
            return;
        }

        const storyStats = await getUserStoryStatsAsync(this.currentTaskDescription);
        
        this.isImplementingUserStory = true;
        this.isGeneratingUserStories = false;
        this.currentUserStoryDescription = story.description;
        
        // Update UI immediately when starting new user story
        this.ui.updateStatus('running', this.taskRunner.getIterationCount(), story.description);
        this.ui.addLog(`📖 User Story (${storyStats.completed + 1}/${storyStats.total}): ${story.description}`);
        
        await this.taskRunner.triggerUserStoryImplementation(
            story.description, 
            this.currentTaskDescription,
            async () => {
                // This callback is called when the user story implementation is complete
                this.ui.addLog('✅ User story implementation completed');
                this.isImplementingUserStory = false;
                this.currentUserStoryDescription = '';
                
                // Schedule next user story (use setTimeout to avoid blocking)
                setTimeout(async () => {
                    if (this.state === LoopExecutionState.RUNNING && !this.isPaused) {
                        await this.runNextUserStory();
                    }
                }, 1000);
            }
        );
        
        // Watch for user stories file changes (as backup)
        this.setupUserStoriesWatcher();
        this.inactivityMonitor.setWaiting(true);
        this.ui.addLog('Copilot is implementing user story...');
    }

    /**
     * Periodically check if task was marked complete in PRD
     */
    private prdCheckInterval: NodeJS.Timeout | null = null;

    private startPrdCompletionCheck(): void {
        this.stopPrdCompletionCheck();
        
        this.prdCheckInterval = setInterval(async () => {
            if (this.state !== LoopExecutionState.RUNNING || this.isPaused) {
                this.stopPrdCompletionCheck();
                return;
            }
            
            const task = await getNextTaskAsync();
            if (!task || task.description !== this.currentTaskDescription) {
                // Task was marked complete
                this.stopPrdCompletionCheck();
                this.fileWatchers.prdWatcher.disable();
                this.inactivityMonitor.stop();
                
                this.ui.addLog('✅ Task marked complete in PRD.md!', true);
                
                const completion = this.taskRunner.recordTaskCompletion();
                await appendProgressAsync(`✅ Completed: ${completion.taskDescription} (took ${Math.round(completion.duration / 1000)}s)`);
                this.ui.updateHistory(this.taskRunner.getTaskHistory());
                await this.updatePanelTiming();
                
                await this.startCountdown();
            }
        }, 2000); // Check every 2 seconds
    }

    private stopPrdCompletionCheck(): void {
        if (this.prdCheckInterval) {
            clearInterval(this.prdCheckInterval);
            this.prdCheckInterval = null;
        }
    }

    /**
     * Set up watcher for user stories file
     */
    private setupUserStoriesWatcher(): void {
        const root = getWorkspaceRoot();
        if (!root) { return; }

        // We use the activity watcher and periodically check the user stories file
        this.fileWatchers.activityWatcher.start(() => {
            this.inactivityMonitor.recordActivity();
            this.checkUserStoriesProgress();
        });

        this.inactivityMonitor.start(() => this.handleInactivity());
    }

    /**
     * Check user stories progress
     */
    private async checkUserStoriesProgress(): Promise<void> {
        if (this.isGeneratingUserStories) {
            // Check if user stories were created
            const hasStories = await hasUserStoriesForTaskAsync(this.currentTaskDescription);
            if (hasStories) {
                this.ui.addLog('✅ User stories generated!', true);
                this.isGeneratingUserStories = false;
                this.inactivityMonitor.stop();
                await this.startCountdown();
            }
        } else if (this.isImplementingUserStory) {
            // Check if current user story was completed
            const story = await getNextUserStoryAsync(this.currentTaskDescription);
            if (!story || story.description !== this.currentUserStoryDescription) {
                this.ui.addLog('✅ User story completed!', true);
                this.isImplementingUserStory = false;
                this.currentUserStoryDescription = '';
                this.inactivityMonitor.stop();
                
                // Log progress
                await appendProgressAsync(`✅ Completed user story: ${this.currentUserStoryDescription}`);
                
                await this.startCountdown();
            }
        }
    }

    /**
     * Handle PRD file changes
     */
    private async handlePrdChange(newContent: string): Promise<void> {
        try {
            this.ui.addLog('📝 PRD.md changed - checking task status...');
            this.inactivityMonitor.recordActivity();
            this.fileWatchers.prdWatcher.updateContent(newContent);

            const task = await getNextTaskAsync();
            const currentTask = this.taskRunner.getCurrentTask();

            if (!task || task.description !== currentTask) {
                this.fileWatchers.prdWatcher.disable();
                this.inactivityMonitor.stop();

                const completion = this.taskRunner.recordTaskCompletion();

                // Append to progress.txt
                const progressEntry = `✅ Completed: ${completion.taskDescription} (took ${Math.round(completion.duration / 1000)}s)`;
                await appendProgressAsync(progressEntry);

                this.ui.updateHistory(this.taskRunner.getTaskHistory());
                await this.updatePanelTiming();

                await this.startCountdown();
            }
        } catch (error) {
            logError('Error handling PRD change', error);
            this.ui.addLog('Error processing PRD change');
        }
    }

    /**
     * Handle inactivity timeout
     */
    private async handleInactivity(): Promise<void> {
        this.ui.addLog('⚠️ No file activity detected for 60 seconds...');

        const action = await vscode.window.showWarningMessage(
            `PilotFlow: No file changes detected for 60 seconds. Is Copilot still working on the task?`,
            'Continue Waiting',
            'Retry Task',
            'Skip Task',
            'Stop Loop'
        );

        switch (action) {
            case 'Continue Waiting':
                this.ui.addLog('Continuing to wait...');
                this.inactivityMonitor.start(() => this.handleInactivity());
                break;
            case 'Retry Task':
                this.ui.addLog('Retrying current task...');
                this.fileWatchers.prdWatcher.disable();
                await this.runNextTask();
                break;
            case 'Skip Task':
                this.ui.addLog('Skipping to next task...');
                this.fileWatchers.prdWatcher.disable();
                this.taskRunner.setCurrentTask('');
                await this.startCountdown();
                break;
            case 'Stop Loop':
                this.stopLoop();
                break;
            default:
                this.inactivityMonitor.start(() => this.handleInactivity());
        }
    }

    /**
     * Start countdown before next task/user story
     */
    private async startCountdown(): Promise<void> {
        this.ui.addLog(`Starting next step in ${REVIEW_COUNTDOWN_SECONDS} seconds...`);

        await this.countdownTimer.start(REVIEW_COUNTDOWN_SECONDS, (remaining) => {
            this.ui.updateCountdown(remaining);
        });

        if (this.state === LoopExecutionState.RUNNING && !this.isPaused) {
            await this.ui.updateStats();
            
            // Check if we should continue with user stories or move to next task
            if (this.currentTaskDescription) {
                const hasStories = await hasUserStoriesForTaskAsync(this.currentTaskDescription);
                const allComplete = hasStories && await areAllUserStoriesCompleteAsync(this.currentTaskDescription);
                
                if (hasStories && !allComplete) {
                    // Continue with next user story
                    await this.runNextUserStory();
                } else {
                    // Move to next task
                    await this.runNextTask();
                }
            } else {
                await this.runNextTask();
            }
        }
    }

    /**
     * Update panel timing display
     */
    private async updatePanelTiming(): Promise<void> {
        const stats = await getTaskStatsAsync();
        this.ui.updateSessionTiming(this.sessionStartTime, this.taskRunner.getTaskHistory(), stats.pending);
    }
}
