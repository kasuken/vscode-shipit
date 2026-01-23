import * as vscode from 'vscode';
import {
    TaskCompletion,
    TaskRequirements,
    PilotFlowSettings,
    DEFAULT_REQUIREMENTS,
    DEFAULT_SETTINGS
} from './types';
import { logError, logInfo } from './logger';
import { getWorkspaceRoot, markUserStoryCompleteAsync, markTaskCompleteAsync, appendProgressAsync } from './fileUtils';
import { buildAgentPromptAsync, buildPrdGenerationPrompt, buildUserStoriesGenerationPrompt, buildUserStoryImplementationPrompt } from './promptBuilder';
import { getCopilotService, CopilotSdkService } from './copilotSdk';
import { formatDuration } from './timerManager';

export type LogCallback = (message: string, highlight?: boolean) => void;
export type TaskCompletionCallback = (type: 'user-story' | 'task', description: string) => void;

/**
 * TaskRunner handles the execution of individual tasks
 */
export class TaskRunner {
    private requirements: TaskRequirements = { ...DEFAULT_REQUIREMENTS };
    private settings: PilotFlowSettings = { ...DEFAULT_SETTINGS };
    private taskHistory: TaskCompletion[] = [];
    private taskStartTime = 0;
    private currentTaskDescription = '';
    private iterationCount = 0;
    private logCallback: LogCallback | null = null;
    private copilotService: CopilotSdkService;

    constructor() {
        this.copilotService = getCopilotService();
    }

    /**
     * Set the log callback
     */
    setLogCallback(callback: LogCallback): void {
        this.logCallback = callback;
        
        // Set up progress handler for Copilot streaming
        this.copilotService.setProgressHandler((message, isComplete) => {
            if (isComplete) {
                this.log('Copilot finished processing');
            }
        });
    }

    private log(message: string, highlight: boolean = false): void {
        this.logCallback?.(message, highlight);
    }

    /**
     * Set task requirements
     */
    setRequirements(requirements: TaskRequirements): void {
        this.requirements = requirements;
        this.log('Updated task requirements');
    }

    /**
     * Get current requirements
     */
    getRequirements(): TaskRequirements {
        return this.requirements;
    }

    /**
     * Set settings
     */
    setSettings(settings: PilotFlowSettings): void {
        this.settings = settings;
        this.log('Updated settings');
    }

    /**
     * Get current settings
     */
    getSettings(): PilotFlowSettings {
        return this.settings;
    }

    /**
     * Get task history
     */
    getTaskHistory(): TaskCompletion[] {
        return [...this.taskHistory];
    }

    /**
     * Clear task history
     */
    clearHistory(): void {
        this.taskHistory = [];
    }

    /**
     * Get current task description
     */
    getCurrentTask(): string {
        return this.currentTaskDescription;
    }

    /**
     * Set current task
     */
    setCurrentTask(description: string): void {
        this.currentTaskDescription = description;
        this.taskStartTime = Date.now();
    }

    /**
     * Get current iteration count
     */
    getIterationCount(): number {
        return this.iterationCount;
    }

    /**
     * Increment iteration count
     */
    incrementIteration(): number {
        return ++this.iterationCount;
    }

    /**
     * Reset iteration count
     */
    resetIterations(): void {
        this.iterationCount = 0;
    }

    /**
     * Record task completion
     */
    recordTaskCompletion(): TaskCompletion {
        const duration = Date.now() - this.taskStartTime;
        const completion: TaskCompletion = {
            taskDescription: this.currentTaskDescription,
            completedAt: Date.now(),
            duration,
            iteration: this.iterationCount
        };
        this.taskHistory.push(completion);
        this.log(`✅ Task completed in ${formatDuration(duration)}!`, true);
        return completion;
    }

    /**
     * Check if iteration limit has been reached
     */
    checkIterationLimit(): boolean {
        if (this.settings.maxIterations > 0 && this.iterationCount >= this.settings.maxIterations) {
            this.log(`🛑 Reached maximum iterations (${this.settings.maxIterations}). Stopping.`, true);
            return true;
        }
        return false;
    }

    /**
     * Trigger Copilot agent mode with a task
     * Returns true if successful, false otherwise
     */
    async triggerCopilotAgent(taskDescription: string): Promise<boolean> {
        try {
            const prompt = await buildAgentPromptAsync(taskDescription, this.requirements);
            this.log('Sending task to Copilot SDK...');
            
            const success = await this.copilotService.executeTask(prompt);
            
            if (success) {
                this.log('Copilot task execution started');
            } else {
                this.log('Failed to execute Copilot task');
            }
            
            return success;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(`Failed to trigger Copilot: ${errorMessage}`);
            logError('Failed to trigger Copilot Agent', error);
            return false;
        }
    }

    /**
     * Trigger PRD generation from a description
     * Returns true if successful, false otherwise
     */
    async triggerPrdGeneration(taskDescription: string): Promise<boolean> {
        const root = getWorkspaceRoot();
        if (!root) {
            vscode.window.showErrorMessage('PilotFlow: No workspace folder open');
            return false;
        }

        this.log('✨ Generating PRD.md from your description...');

        try {
            const prompt = buildPrdGenerationPrompt(taskDescription, root);
            const success = await this.copilotService.executeTask(prompt, { model: 'gpt-5.2' });

            if (success) {
                this.log('PRD generation task sent to Copilot (using gpt-5.2)');
            } else {
                this.log('Failed to execute PRD generation');
            }
            
            return success;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(`Failed to open Copilot for PRD: ${errorMessage}`);
            logError('Failed to open Copilot for PRD generation', error);
            return false;
        }
    }

    /**
     * Trigger user stories generation for a task
     * Returns true if successful, false otherwise
     */
    async triggerUserStoriesGeneration(
        taskDescription: string, 
        taskId: string,
        onComplete?: () => void | Promise<void>
    ): Promise<boolean> {
        this.log('✨ Generating user stories for task...');

        try {
            const prompt = await buildUserStoriesGenerationPrompt(taskDescription, taskId, this.settings.userStoriesCountPerTask);
            const success = await this.copilotService.executeTask(prompt, { 
                model: 'gpt-5.2',
                onComplete: async () => {
                    this.log('✅ User stories generation completed');
                    await appendProgressAsync(`Generated user stories for task: ${taskDescription.substring(0, 100)}`);
                    if (onComplete) {
                        await onComplete();
                    }
                }
            });

            if (success) {
                this.log('User stories generation task sent to Copilot (using gpt-5.2)');
            } else {
                this.log('Failed to execute user stories generation');
            }
            
            return success;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(`Failed to generate user stories: ${errorMessage}`);
            logError('Failed to generate user stories', error);
            return false;
        }
    }

    /**
     * Trigger implementation of a user story
     * Returns true if successful, false otherwise
     * Automatically marks the user story as complete when done
     */
    async triggerUserStoryImplementation(
        userStoryDescription: string,
        taskDescription: string,
        onComplete?: () => void | Promise<void>
    ): Promise<boolean> {
        try {
            const prompt = await buildUserStoryImplementationPrompt(
                userStoryDescription,
                taskDescription,
                this.requirements
            );

            this.log('Sending user story implementation to Copilot...');
            const success = await this.copilotService.executeTask(prompt, { 
                model: 'gpt-5-mini',
                onComplete: async () => {
                    // Mark the user story as complete in userstories.md
                    const marked = await markUserStoryCompleteAsync(userStoryDescription);
                    if (marked) {
                        this.log(`✅ User story marked as complete: ${userStoryDescription.substring(0, 50)}...`);
                        // Log progress
                        await appendProgressAsync(`Completed user story: ${userStoryDescription.substring(0, 100)}`);
                    } else {
                        this.log(`⚠️ Could not find user story to mark complete`);
                    }
                    
                    // Call the external onComplete callback if provided
                    if (onComplete) {
                        await onComplete();
                    }
                }
            });

            if (success) {
                this.log('User story implementation task sent to Copilot (using gpt-5-mini)');
            } else {
                this.log('Failed to execute user story implementation');
            }
            
            return success;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(`Failed to trigger Copilot: ${errorMessage}`);
            logError('Failed to trigger Copilot Agent for user story', error);
            return false;
        }
    }

    /**
     * Abort the current Copilot operation
     */
    async abortCopilot(): Promise<void> {
        await this.copilotService.abort();
        this.log('Copilot operation aborted');
    }

    /**
     * Start the Copilot service
     */
    async startCopilotService(): Promise<boolean> {
        return await this.copilotService.start();
    }

    /**
     * Stop the Copilot service
     */
    async stopCopilotService(): Promise<void> {
        await this.copilotService.stop();
    }
}
