import * as vscode from 'vscode';
import * as path from 'path';
import * as fsPromises from 'fs/promises';

import { Task, TaskStatus, TaskStats, UserStory, UserStoryStatus, UserStoryStats } from './types';
import { getConfig } from './config';
import { logError } from './logger';

/**
 * Ensure a directory exists, creating it if necessary
 */
async function ensureDirectoryExists(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    try {
        await fsPromises.mkdir(dir, { recursive: true });
    } catch (error) {
        logError(`Failed to create directory: ${dir}`, error);
    }
}

/**
 * Get the workspace root folder path
 */
export function getWorkspaceRoot(): string | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        return workspaceFolders[0].uri.fsPath;
    }
    return null;
}

/**
 * Read the PRD file contents
 * Checks configured path first, then falls back to PRD.md at root
 */
export async function readPRDAsync(): Promise<string | null> {
    const config = getConfig();
    const root = getWorkspaceRoot();
    if (!root) { 
        console.log('[ShipIt] No workspace root found');
        return null; 
    }

    const prdPath = path.join(root, config.files.prdPath);
    console.log('[ShipIt] Looking for PRD at:', prdPath);
    
    // Try configured path first
    try {
        await fsPromises.access(prdPath);
        console.log('[ShipIt] Found PRD at configured path');
        return await fsPromises.readFile(prdPath, 'utf-8');
    } catch {
        console.log('[ShipIt] PRD not found at configured path, trying fallback');
    }

    // Fallback: check for PRD.md at root
    const fallbackPath = path.join(root, 'PRD.md');
    console.log('[ShipIt] Looking for PRD at fallback:', fallbackPath);
    try {
        await fsPromises.access(fallbackPath);
        console.log('[ShipIt] Found PRD at fallback path');
        return await fsPromises.readFile(fallbackPath, 'utf-8');
    } catch (error) {
        console.log('[ShipIt] PRD not found at fallback path either');
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            logError('Failed to read PRD.md', error);
        }
        return null;
    }
}

/**
 * Read the progress file contents
 */
export async function readProgressAsync(): Promise<string> {
    const config = getConfig();
    const root = getWorkspaceRoot();
    if (!root) { return ''; }

    const progressPath = path.join(root, config.files.progressPath);
    try {
        await fsPromises.access(progressPath);
        return await fsPromises.readFile(progressPath, 'utf-8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            logError('Failed to read progress.txt', error);
        }
        return '';
    }
}

/**
 * Append an entry to the progress file
 */
export async function appendProgressAsync(entry: string): Promise<boolean> {
    const config = getConfig();
    const root = getWorkspaceRoot();
    if (!root) { return false; }

    const progressPath = path.join(root, config.files.progressPath);
    await ensureDirectoryExists(progressPath);
    try {
        const timestamp = new Date().toISOString();
        const formattedEntry = `[${timestamp}] ${entry}\n`;
        await fsPromises.appendFile(progressPath, formattedEntry, 'utf-8');
        return true;
    } catch (error) {
        logError('Failed to append to progress.txt', error);
        return false;
    }
}

/**
 * Ensure the progress file exists
 */
export async function ensureProgressFileAsync(): Promise<boolean> {
    const config = getConfig();
    const root = getWorkspaceRoot();
    if (!root) { return false; }

    const progressPath = path.join(root, config.files.progressPath);
    await ensureDirectoryExists(progressPath);
    try {
        await fsPromises.access(progressPath);
        return true;
    } catch {
        // File doesn't exist, create it
        try {
            await fsPromises.writeFile(progressPath, '# Progress Log\n\n', 'utf-8');
            return true;
        } catch (error) {
            logError('Failed to create progress.txt', error);
            return false;
        }
    }
}

/**
 * Parse tasks from PRD content
 * Supports:
 * - [ ] Pending task
 * - [x] Completed task
 * - [~] In progress task
 * - [!] Blocked task
 */
function parseTasksFromContent(content: string): Task[] {
    const tasks: Task[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match checkbox format: - [ ] or * [ ] with various markers
        const match = /^[-*]\s*\[([ x~!])\]\s*(.+)$/im.exec(line);

        if (match) {
            const marker = match[1].toLowerCase();
            const description = match[2].trim();

            let status: TaskStatus;
            switch (marker) {
                case 'x':
                    status = TaskStatus.COMPLETE;
                    break;
                case '~':
                    status = TaskStatus.IN_PROGRESS;
                    break;
                case '!':
                    status = TaskStatus.BLOCKED;
                    break;
                default:
                    status = TaskStatus.PENDING;
            }

            tasks.push({
                id: `task-${i + 1}`,
                description,
                status,
                lineNumber: i + 1,
                rawLine: line
            });
        }
    }

    return tasks;
}

/**
 * Parse tasks from the PRD file
 */
export async function parseTasksAsync(): Promise<Task[]> {
    const content = await readPRDAsync();
    if (!content) { return []; }
    return parseTasksFromContent(content);
}

/**
 * Get all tasks from the PRD (with user story status)
 */
export async function getAllTasksAsync(): Promise<Task[]> {
    const tasks = await parseTasksAsync();
    
    // Enrich tasks with user story information
    const userStoriesContent = await readUserStoriesAsync();
    
    for (const task of tasks) {
        task.hasUserStories = userStoriesContent 
            ? hasUserStoriesInContent(userStoriesContent, task.description)
            : false;
    }
    
    return tasks;
}

/**
 * Check if user stories exist for a task in the content
 */
function hasUserStoriesInContent(content: string, taskDescription: string): boolean {
    const escapedTask = escapeRegExp(taskDescription);
    const taskSectionPattern = new RegExp(`^##\\s+Task:\\s*${escapedTask}`, 'im');
    
    if (!taskSectionPattern.test(content)) {
        return false;
    }
    
    // Find the section and check if it has any user stories
    const lines = content.split('\n');
    let inTaskSection = false;
    
    for (const line of lines) {
        if (line.match(/^##\s+Task:/i)) {
            inTaskSection = taskSectionPattern.test(line);
            continue;
        }
        
        if (!inTaskSection) { continue; }
        
        // Found a user story in this section
        if (/^[-*]\s*\[([ x~])\]\s*(.+)$/im.test(line)) {
            return true;
        }
    }
    
    return false;
}

/**
 * Get the next pending or in-progress task
 */
export async function getNextTaskAsync(): Promise<Task | null> {
    const tasks = await parseTasksAsync();
    return tasks.find(t => t.status === TaskStatus.PENDING || t.status === TaskStatus.IN_PROGRESS) || null;
}

/**
 * Get task statistics
 */
export async function getTaskStatsAsync(): Promise<TaskStats> {
    const tasks = await parseTasksAsync();
    return {
        total: tasks.length,
        completed: tasks.filter(t => t.status === TaskStatus.COMPLETE).length,
        pending: tasks.filter(t => t.status === TaskStatus.PENDING || t.status === TaskStatus.IN_PROGRESS).length
    };
}

/**
 * Get the PRD file path
 */
export function getPrdPath(): string | null {
    const config = getConfig();
    const root = getWorkspaceRoot();
    if (!root) { return null; }
    return path.join(root, config.files.prdPath);
}

/**
 * Sample PRD content for manual creation
 */
const SAMPLE_PRD_CONTENT = `# Product Requirements Document

## Project Overview
<!-- Describe your project here -->
A brief description of what you're building and why.

## Goals
- Define the main goals of your project
- What problems does it solve?

## Features

### Core Features
<!-- List your main tasks as checkboxes. ShipIt will pick these up! -->

- [ ] Create the project structure and initial setup
- [ ] Implement feature one with basic functionality
- [ ] Add unit tests for core components
- [ ] Implement feature two
- [ ] Add documentation

### Nice to Have
- [ ] Additional feature ideas for later

## Technical Notes
<!-- Add any technical considerations, constraints, or notes -->
- Technology stack: 
- Key dependencies:
- API integrations:

## Success Criteria
- Define what "done" looks like for this project
`;

/**
 * Sample project description template
 */
const SAMPLE_PROJECT_DESCRIPTION = `# Project Description

Write a detailed description of what you want to build.
When you save this file and click "Generate PRD" again, ShipIt will use this description to create your PRD.

## Instructions
1. Replace this template with your project description
2. Include features, requirements, and technical details
3. Be as specific as possible
4. Save the file (Ctrl+S / Cmd+S)
5. Click "Generate PRD" button again

## Example
A REST API for managing todo items with user authentication, using Node.js and PostgreSQL.
Features: 
- User registration and login with JWT tokens
- CRUD operations for todos (create, read, update, delete)
- Task categorization with tags
- Due date reminders via email
- RESTful endpoints following best practices
- Comprehensive unit and integration tests

════════════════════════════════════════════════════════════════════════════════

## Your Project Description

`;

/**
 * Create a manual PRD file with sample content
 * @returns true if the file was created and opened successfully
 */
export async function createManualPrdAsync(): Promise<boolean> {
    const prdPath = getPrdPath();
    if (!prdPath) {
        vscode.window.showErrorMessage('No workspace folder open');
        return false;
    }

    // Check if PRD already exists
    try {
        await fsPromises.access(prdPath);
        // File exists, ask user if they want to open it
        const action = await vscode.window.showWarningMessage(
            'A PRD file already exists. Do you want to open it?',
            'Open',
            'Cancel'
        );
        if (action === 'Open') {
            const doc = await vscode.workspace.openTextDocument(prdPath);
            await vscode.window.showTextDocument(doc);
            return true;
        }
        return false;
    } catch {
        // File doesn't exist, create it
    }

    await ensureDirectoryExists(prdPath);
    
    try {
        await fsPromises.writeFile(prdPath, SAMPLE_PRD_CONTENT, 'utf-8');
        
        // Open the file in the editor
        const doc = await vscode.workspace.openTextDocument(prdPath);
        await vscode.window.showTextDocument(doc);
        
        vscode.window.showInformationMessage('PRD.md created! Edit the tasks and start ShipIt when ready.');
        return true;
    } catch (error) {
        logError('Failed to create PRD.md', error);
        vscode.window.showErrorMessage('Failed to create PRD.md');
        return false;
    }
}

// ============================================================================
// Project Description File Management
// ============================================================================

const PROJECT_DESCRIPTION_FILENAME = '.shipit/project_description.md';

/**
 * Get the project description file path
 */
export function getProjectDescriptionPath(): string | null {
    const root = getWorkspaceRoot();
    if (!root) { return null; }
    return path.join(root, PROJECT_DESCRIPTION_FILENAME);
}

/**
 * Read the project description file
 */
export async function readProjectDescriptionAsync(): Promise<string | null> {
    const descPath = getProjectDescriptionPath();
    if (!descPath) { return null; }

    try {
        await fsPromises.access(descPath);
        const content = await fsPromises.readFile(descPath, 'utf-8');
        
        // Extract actual description (remove template if still present)
        const separator = '═';
        if (content.includes(separator)) {
            const parts = content.split(new RegExp(`${separator}+`));
            const extracted = parts.length > 1 ? parts[parts.length - 1].trim() : content;
            
            // Check if user actually wrote something meaningful
            const headerPattern = /^##\s*Your Project Description/im;
            const cleanedContent = extracted.replace(headerPattern, '').trim();
            
            return cleanedContent.length > 20 ? cleanedContent : null;
        }
        
        return content.trim().length > 20 ? content.trim() : null;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            logError('Failed to read project_description.md', error);
        }
        return null;
    }
}

/**
 * Create or open the project description file
 */
export async function createOrOpenProjectDescriptionAsync(): Promise<boolean> {
    const descPath = getProjectDescriptionPath();
    if (!descPath) {
        vscode.window.showErrorMessage('No workspace folder open');
        return false;
    }

    await ensureDirectoryExists(descPath);
    
    try {
        // Check if file exists
        try {
            await fsPromises.access(descPath);
        } catch {
            // File doesn't exist, create it with template
            await fsPromises.writeFile(descPath, SAMPLE_PROJECT_DESCRIPTION, 'utf-8');
        }
        
        // Open the file
        const doc = await vscode.workspace.openTextDocument(descPath);
        await vscode.window.showTextDocument(doc);
        
        return true;
    } catch (error) {
        logError('Failed to create/open project_description.md', error);
        vscode.window.showErrorMessage('Failed to open project description file');
        return false;
    }
}

// ============================================================================
// User Stories File Management
// ============================================================================

const USER_STORIES_FILENAME = '.shipit/userstories.md';

/**
 * Get the user stories file path
 */
export function getUserStoriesPath(): string | null {
    const root = getWorkspaceRoot();
    if (!root) { return null; }
    return path.join(root, USER_STORIES_FILENAME);
}

/**
 * Read the user stories file contents
 */
export async function readUserStoriesAsync(): Promise<string | null> {
    const storiesPath = getUserStoriesPath();
    if (!storiesPath) { return null; }

    await ensureDirectoryExists(storiesPath);
    try {
        await fsPromises.access(storiesPath);
        return await fsPromises.readFile(storiesPath, 'utf-8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            logError('Failed to read userstories.md', error);
        }
        return null;
    }
}

/**
 * Write content to the user stories file
 */
export async function writeUserStoriesAsync(content: string): Promise<boolean> {
    const storiesPath = getUserStoriesPath();
    if (!storiesPath) { return false; }

    await ensureDirectoryExists(storiesPath);
    try {
        await fsPromises.writeFile(storiesPath, content, 'utf-8');
        return true;
    } catch (error) {
        logError('Failed to write userstories.md', error);
        return false;
    }
}

/**
 * Parse user stories from content for a specific task
 */
function parseUserStoriesFromContent(content: string, taskId: string): UserStory[] {
    const stories: UserStory[] = [];
    const lines = content.split('\n');

    // Find the section for this task
    let inTaskSection = false;
    let taskSectionPattern = new RegExp(`^##\\s+Task:\\s*${escapeRegExp(taskId)}`, 'i');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check if we're entering a task section
        if (line.match(/^##\s+Task:/i)) {
            inTaskSection = taskSectionPattern.test(line);
            continue;
        }

        // Skip if not in the right task section
        if (!inTaskSection) { continue; }

        // Match user story checkbox format: - [ ] or - [x]
        const match = /^[-*]\s*\[([ x~])\]\s*(.+)$/im.exec(line);
        if (match) {
            const marker = match[1].toLowerCase();
            const description = match[2].trim();

            let status: UserStoryStatus;
            switch (marker) {
                case 'x':
                    status = UserStoryStatus.COMPLETE;
                    break;
                case '~':
                    status = UserStoryStatus.IN_PROGRESS;
                    break;
                default:
                    status = UserStoryStatus.PENDING;
            }

            stories.push({
                id: `story-${taskId}-${stories.length + 1}`,
                taskId,
                description,
                status,
                lineNumber: i + 1
            });
        }
    }

    return stories;
}

/**
 * Escape special regex characters
 */
function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Get user stories for a specific task
 */
export async function getUserStoriesForTaskAsync(taskId: string): Promise<UserStory[]> {
    const content = await readUserStoriesAsync();
    if (!content) { return []; }
    return parseUserStoriesFromContent(content, taskId);
}

/**
 * Get all user stories from the file
 */
export async function getAllUserStoriesAsync(): Promise<UserStory[]> {
    const content = await readUserStoriesAsync();
    if (!content) { return []; }

    const stories: UserStory[] = [];
    const lines = content.split('\n');
    let currentTaskId = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check for task section header
        const taskMatch = line.match(/^##\s+Task:\s*(.+)$/i);
        if (taskMatch) {
            currentTaskId = taskMatch[1].trim();
            continue;
        }

        if (!currentTaskId) { continue; }

        // Match user story checkbox format
        const storyMatch = /^[-*]\s*\[([ x~])\]\s*(.+)$/im.exec(line);
        if (storyMatch) {
            const marker = storyMatch[1].toLowerCase();
            const description = storyMatch[2].trim();

            let status: UserStoryStatus;
            switch (marker) {
                case 'x':
                    status = UserStoryStatus.COMPLETE;
                    break;
                case '~':
                    status = UserStoryStatus.IN_PROGRESS;
                    break;
                default:
                    status = UserStoryStatus.PENDING;
            }

            stories.push({
                id: `story-${currentTaskId}-${stories.length + 1}`,
                taskId: currentTaskId,
                description,
                status,
                lineNumber: i + 1
            });
        }
    }

    return stories;
}

/**
 * Get the next pending user story for a task
 */
export async function getNextUserStoryAsync(taskId: string): Promise<UserStory | null> {
    const stories = await getUserStoriesForTaskAsync(taskId);
    return stories.find(s => s.status === UserStoryStatus.PENDING || s.status === UserStoryStatus.IN_PROGRESS) || null;
}

/**
 * Get user story statistics for a task
 */
export async function getUserStoryStatsAsync(taskId: string): Promise<UserStoryStats> {
    const stories = await getUserStoriesForTaskAsync(taskId);
    return {
        total: stories.length,
        completed: stories.filter(s => s.status === UserStoryStatus.COMPLETE).length,
        pending: stories.filter(s => s.status === UserStoryStatus.PENDING || s.status === UserStoryStatus.IN_PROGRESS).length
    };
}

/**
 * Check if user stories exist for a task
 */
export async function hasUserStoriesForTaskAsync(taskId: string): Promise<boolean> {
    const stories = await getUserStoriesForTaskAsync(taskId);
    return stories.length > 0;
}

/**
 * Check if all user stories for a task are complete
 */
export async function areAllUserStoriesCompleteAsync(taskId: string): Promise<boolean> {
    const stories = await getUserStoriesForTaskAsync(taskId);
    if (stories.length === 0) { return false; }
    return stories.every(s => s.status === UserStoryStatus.COMPLETE);
}

/**
 * Mark a user story as complete by updating its checkbox from [ ] to [x]
 * @param userStoryDescription The description text of the user story to mark complete
 * @returns true if the user story was found and marked complete, false otherwise
 */
export async function markUserStoryCompleteAsync(userStoryDescription: string): Promise<boolean> {
    const content = await readUserStoriesAsync();
    if (!content) { return false; }

    const lines = content.split('\n');
    let modified = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match pending or in-progress user story checkbox
        const match = /^([-*]\s*)\[([ ~])\]\s*(.+)$/im.exec(line);
        if (match) {
            const description = match[3].trim();
            // Check if this is the user story we're looking for
            if (description === userStoryDescription.trim() || 
                description.includes(userStoryDescription.trim()) ||
                userStoryDescription.trim().includes(description)) {
                // Mark as complete
                lines[i] = `${match[1]}[x] ${description}`;
                modified = true;
                break;
            }
        }
    }

    if (modified) {
        return await writeUserStoriesAsync(lines.join('\n'));
    }
    
    return false;
}
