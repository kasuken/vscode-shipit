/**
 * Execution state of the main loop
 */
export enum LoopExecutionState {
    IDLE = 'IDLE',
    RUNNING = 'RUNNING'
}

/**
 * Status of an individual task
 */
export enum TaskStatus {
    PENDING = 'PENDING',
    IN_PROGRESS = 'IN_PROGRESS',
    COMPLETE = 'COMPLETE',
    BLOCKED = 'BLOCKED'
}

/**
 * Represents a task parsed from the PRD
 */
export interface Task {
    id: string;
    description: string;
    status: TaskStatus;
    lineNumber: number;
    rawLine: string;
}

/**
 * Configuration for PilotFlow
 */
export interface PilotFlowConfig {
    files: {
        prdPath: string;
        progressPath: string;
    };
    prompt: {
        customTemplate: string;
        customPrdGenerationTemplate: string;
    };
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: PilotFlowConfig = {
    files: {
        prdPath: '.pilotflow/PRD.md',
        progressPath: '.pilotflow/progress.txt'
    },
    prompt: {
        customTemplate: '',
        customPrdGenerationTemplate: ''
    }
};

/**
 * Record of a completed task
 */
export interface TaskCompletion {
    taskDescription: string;
    completedAt: number;
    duration: number;
    iteration: number;
}

/**
 * Requirements that must be met before marking a task complete
 */
export interface TaskRequirements {
    runTests: boolean;
    runLinting: boolean;
    runTypeCheck: boolean;
    writeTests: boolean;
    updateDocs: boolean;
    commitChanges: boolean;
}

/**
 * Default task requirements
 */
export const DEFAULT_REQUIREMENTS: TaskRequirements = {
    runTests: false,
    runLinting: false,
    runTypeCheck: false,
    writeTests: false,
    updateDocs: false,
    commitChanges: false
};

/**
 * PilotFlow settings
 */
export interface PilotFlowSettings {
    maxIterations: number;
}

/**
 * Default settings
 */
export const DEFAULT_SETTINGS: PilotFlowSettings = {
    maxIterations: 50
};

/**
 * Countdown before starting next task (seconds)
 */
export const REVIEW_COUNTDOWN_SECONDS = 12;

/**
 * Inactivity timeout before prompting user (milliseconds)
 */
export const INACTIVITY_TIMEOUT_MS = 60_000;

/**
 * Interval to check for inactivity (milliseconds)
 */
export const INACTIVITY_CHECK_INTERVAL_MS = 10_000;

/**
 * UI interface for status updates
 */
export interface IPilotFlowUI {
    updateStatus(status: string, iteration: number, currentTask: string, history: TaskCompletion[]): void;
    updateCountdown(seconds: number): void;
    updateHistory(history: TaskCompletion[]): void;
    updateSessionTiming(startTime: number, taskHistory: TaskCompletion[], pendingTasks: number): void;
    updateStats(): void | Promise<void>;
    refresh(): void | Promise<void>;
    addLog(message: string, highlight?: boolean): void;
    showPrdGenerating(): void;
}

/**
 * Task statistics
 */
export interface TaskStats {
    total: number;
    completed: number;
    pending: number;
}
