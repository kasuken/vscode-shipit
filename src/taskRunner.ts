import * as vscode from 'vscode';
import {
    TaskCompletion,
    TaskRequirements,
    PilotFlowSettings,
    DEFAULT_REQUIREMENTS,
    DEFAULT_SETTINGS
} from './types';
import { logError } from './logger';
import { getWorkspaceRoot } from './fileUtils';
import { buildAgentPromptAsync, buildPrdGenerationPrompt, buildUserStoriesGenerationPrompt, buildUserStoryImplementationPrompt } from './promptBuilder';
import { openCopilotWithPrompt, CopilotResult } from './copilotIntegration';
import { formatDuration } from './timerManager';

export type LogCallback = (message: string, highlight?: boolean) => void;

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

    /**
     * Set the log callback
     */
    setLogCallback(callback: LogCallback): void {
        this.logCallback = callback;
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
     */
    async triggerCopilotAgent(taskDescription: string): Promise<CopilotResult | null> {
        try {
            const prompt = await buildAgentPromptAsync(taskDescription, this.requirements);
            const method = await openCopilotWithPrompt(prompt, { freshChat: true });
            this.log(
                method === 'agent' ? 'Opened Copilot Agent Mode' :
                    method === 'chat' ? 'Opened Copilot Chat' :
                        'Prompt copied to clipboard'
            );
            return method;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(`Failed to trigger Copilot: ${errorMessage}`);
            logError('Failed to trigger Copilot Agent', error);
            return null;
        }
    }

    /**
     * Trigger PRD generation from a description
     */
    async triggerPrdGeneration(taskDescription: string): Promise<CopilotResult | null> {
        const root = getWorkspaceRoot();
        if (!root) {
            vscode.window.showErrorMessage('PilotFlow: No workspace folder open');
            return null;
        }

        this.log('✨ Generating PRD.md from your description...');

        try {
            const prompt = buildPrdGenerationPrompt(taskDescription, root);
            const method = await openCopilotWithPrompt(prompt, { freshChat: true });
            this.log(
                method === 'agent' ? 'Opened Copilot Agent Mode' :
                    method === 'chat' ? 'Opened Copilot Chat' :
                        'Prompt copied to clipboard'
            );
            return method;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(`Failed to open Copilot for PRD: ${errorMessage}`);
            logError('Failed to open Copilot for PRD generation', error);
            return null;
        }
    }

    /**
     * Trigger user stories generation for a task
     */
    async triggerUserStoriesGeneration(taskDescription: string, taskId: string): Promise<CopilotResult | null> {
        this.log('✨ Generating user stories for task...');

        try {
            const prompt = await buildUserStoriesGenerationPrompt(taskDescription, taskId);
            const method = await openCopilotWithPrompt(prompt, { freshChat: true });
            this.log(
                method === 'agent' ? 'Opened Copilot Agent Mode for user stories generation' :
                    method === 'chat' ? 'Opened Copilot Chat for user stories generation' :
                        'Prompt copied to clipboard'
            );
            return method;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(`Failed to generate user stories: ${errorMessage}`);
            logError('Failed to generate user stories', error);
            return null;
        }
    }

    /**
     * Trigger implementation of a user story
     */
    async triggerUserStoryImplementation(
        userStoryDescription: string,
        taskDescription: string
    ): Promise<CopilotResult | null> {
        try {
            const prompt = await buildUserStoryImplementationPrompt(
                userStoryDescription,
                taskDescription,
                this.requirements
            );

            const method = await openCopilotWithPrompt(prompt, { freshChat: true });
            this.log(
                method === 'agent' ? 'Opened Copilot Agent Mode' :
                    method === 'chat' ? 'Opened Copilot Chat' :
                        'Prompt copied to clipboard'
            );
            return method;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(`Failed to trigger Copilot: ${errorMessage}`);
            logError('Failed to trigger Copilot Agent for user story', error);
            return null;
        }
    }
}
