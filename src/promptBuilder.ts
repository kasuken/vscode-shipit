import { TaskRequirements } from './types';
import { readPRDAsync, readProgressAsync, getWorkspaceRoot, readUserStoriesAsync } from './fileUtils';
import { getConfig } from './config';

const MAX_TASK_DESCRIPTION_LENGTH = 5000;

/**
 * Sanitize task description to prevent injection and limit length
 */
export function sanitizeTaskDescription(input: string): string {
    if (!input || typeof input !== 'string') {
        return '';
    }

    let sanitized = input.trim().slice(0, MAX_TASK_DESCRIPTION_LENGTH);

    // Remove control characters
    // eslint-disable-next-line no-control-regex
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // Normalize excessive newlines
    sanitized = sanitized.replace(/\n{3,}/g, '\n\n');

    // Escape code blocks to prevent prompt injection
    sanitized = sanitized.replace(/^```/gm, '\\`\\`\\`');

    return sanitized;
}

interface TemplateVariables {
    task: string;
    prd: string;
    progress: string;
    requirements: string;
    workspace: string;
}

/**
 * Apply custom template by replacing placeholder variables
 * Supported placeholders: {{task}}, {{prd}}, {{progress}}, {{requirements}}, {{workspace}}
 */
export function applyCustomTemplate(template: string, variables: TemplateVariables): string {
    return template
        .replace(/\{\{task\}\}/g, variables.task)
        .replace(/\{\{prd\}\}/g, variables.prd)
        .replace(/\{\{progress\}\}/g, variables.progress)
        .replace(/\{\{requirements\}\}/g, variables.requirements)
        .replace(/\{\{workspace\}\}/g, variables.workspace);
}

/**
 * Build the requirements steps list
 */
function buildRequirementsSteps(taskDescription: string, requirements: TaskRequirements): string[] {
    const reqSteps: string[] = ['1. ✅ Implement the task'];
    let stepNum = 2;

    if (requirements.writeTests) {
        reqSteps.push(`${stepNum}. ✅ Write unit tests for your implementation`);
        stepNum++;
    }
    if (requirements.runTests) {
        reqSteps.push(`${stepNum}. ✅ Run tests and ensure they pass`);
        stepNum++;
    }
    if (requirements.runTypeCheck) {
        reqSteps.push(`${stepNum}. ✅ Run type checking (tsc --noEmit or equivalent)`);
        stepNum++;
    }
    if (requirements.runLinting) {
        reqSteps.push(`${stepNum}. ✅ Run linting and fix any issues`);
        stepNum++;
    }
    if (requirements.updateDocs) {
        reqSteps.push(`${stepNum}. ✅ Update documentation if needed`);
        stepNum++;
    }
    if (requirements.commitChanges) {
        reqSteps.push(`${stepNum}. ✅ Commit your changes with a descriptive message`);
        stepNum++;
    }
    reqSteps.push(`${stepNum}. ✅ UPDATE PRD.md: Change "- [ ] ${taskDescription}" to "- [x] ${taskDescription}"`);
    stepNum++;
    reqSteps.push(`${stepNum}. ✅ APPEND to progress.txt: Record what you completed`);

    return reqSteps;
}

/**
 * Build the agent prompt for a task
 */
export async function buildAgentPromptAsync(taskDescription: string, requirements: TaskRequirements): Promise<string> {
    const sanitizedTask = sanitizeTaskDescription(taskDescription);
    const config = getConfig();

    const prd = await readPRDAsync() || '';
    const progress = await readProgressAsync();
    const root = getWorkspaceRoot();

    // Check if custom template is provided
    if (config.prompt.customTemplate && config.prompt.customTemplate.trim()) {
        return applyCustomTemplate(config.prompt.customTemplate, {
            task: sanitizedTask,
            prd: prd,
            progress: progress || '',
            requirements: buildRequirementsSteps(sanitizedTask, requirements).join('\n'),
            workspace: root || ''
        });
    }

    const parts: string[] = [
        '',
        '===================================================================',
        '                       YOUR TASK TO IMPLEMENT',
        '===================================================================',
        '',
        sanitizedTask,
        '',
        '===================================================================',
        '          MANDATORY: UPDATE PRD.md AND progress.txt WHEN DONE',
        '═══════════════════════════════════════════════════════════════',
        '',
        '🚨 THESE STEPS ARE REQUIRED - DO NOT SKIP THEM! 🚨',
        '',
        '1. After completing the task, UPDATE PRD.md:',
        '',
        `   Find this line:    - [ ] ${sanitizedTask}`,
        `   Change it to:      - [x] ${sanitizedTask}`,
        '',
        '2. APPEND to progress.txt with what you did:',
        '',
        '   Add a new line describing what was completed, e.g.:',
        `   "Completed: ${sanitizedTask} - [brief summary of changes made]"`,
        '',
        'Both updates are required for PilotFlow to continue to the next task!',
        '',
        '═══════════════════════════════════════════════════════════════',
        '                      PROJECT CONTEXT',
        '═══════════════════════════════════════════════════════════════',
        '',
        '## Current PRD.md Contents:',
        '',
        '┌─────────────────────────────────────────────────────────────┐',
        prd || '(No PRD content found)',
        '└─────────────────────────────────────────────────────────────┘',
        ''
    ];

    if (progress && progress.trim()) {
        parts.push('## Progress Log (progress.txt):');
        parts.push('This file tracks completed work. Append your progress here when done.');
        parts.push('');
        parts.push('┌─────────────────────────────────────────────────────────────┐');
        parts.push(progress);
        parts.push('└─────────────────────────────────────────────────────────────┘');
        parts.push('');
    } else {
        parts.push('## Progress Log (progress.txt):');
        parts.push('No progress recorded yet. Create or append to progress.txt when you complete this task.');
        parts.push('');
    }

    parts.push('═══════════════════════════════════════════════════════════════');
    parts.push('                       WORKFLOW REMINDER');
    parts.push('═══════════════════════════════════════════════════════════════');
    parts.push('');

    const reqSteps = buildRequirementsSteps(sanitizedTask, requirements);
    parts.push(...reqSteps);
    parts.push('');
    parts.push(`Workspace: ${root}`);
    parts.push('');
    parts.push('Begin now. Remember: updating both PRD.md and progress.txt when done is MANDATORY!');

    return parts.join('\n');
}

/**
 * Build the prompt for PRD generation
 */
export function buildPrdGenerationPrompt(taskDescription: string, workspaceRoot: string): string {
    const sanitizedTask = sanitizeTaskDescription(taskDescription);
    const config = getConfig();

    // Check if custom PRD generation template is provided
    if (config.prompt.customPrdGenerationTemplate && config.prompt.customPrdGenerationTemplate.trim()) {
        return applyCustomTemplate(config.prompt.customPrdGenerationTemplate, {
            task: sanitizedTask,
            workspace: workspaceRoot,
            prd: '',
            progress: '',
            requirements: ''
        });
    }

    return `

===================================================================
                       CREATE PRD.md FILE
===================================================================

You are a PRD Generator. Your role is to create clear, actionable PRD files.

The user wants to build something. Your job is to create a PRD.md file with a structured task list.

## USER'S REQUEST:
${sanitizedTask}

===================================================================
                    REQUIRED OUTPUT FORMAT
===================================================================

Create a file called \`PRD.md\` in the workspace root with this EXACT structure:

\`\`\`markdown
# Project Name

## Tasks
- [ ] Task 1: Clear, actionable task description
- [ ] Task 2: Another specific task
- [ ] Task 3: Continue breaking down the work
... (add more tasks as needed)
\`\`\`

═══════════════════════════════════════════════════════════════
                      ⚠️ IMPORTANT RULES
═══════════════════════════════════════════════════════════════

1. **Task Format**: Each task MUST use \`- [ ] \` checkbox format (this is how PilotFlow tracks progress)
2. **Keep it SHORT**: Generate exactly 5-6 tasks maximum. Each task runs as a separate agent request.
3. **Logical Order**: Order tasks so they can be completed sequentially
4. **Comprehensive Tasks**: Each task should accomplish a meaningful chunk of work (not too granular!)
5. **Clear Actions**: Start each task with a verb (Create, Add, Implement, Configure, etc.)

## EXAMPLE TASKS (good - notice only 5 tasks!):
- [ ] Set up project structure with dependencies and configuration
- [ ] Create the core data models and types
- [ ] Implement the main application logic and components
- [ ] Add user interface and styling
- [ ] Write tests and documentation

## BAD TASKS (too many or too granular):
- [ ] Create package.json (too small - combine with other setup)
- [ ] Add button component (too granular - combine UI work)
- [ ] 20+ tasks (way too many - keep it to 5-6!)

═══════════════════════════════════════════════════════════════

Workspace: ${workspaceRoot}

Now create the PRD.md file based on the user's request above. Make the tasks specific and actionable.`;
}

/**
 * Build the prompt for generating user stories from a task
 */
export async function buildUserStoriesGenerationPrompt(taskDescription: string, taskId: string, storyCount: number = 3): Promise<string> {
    const sanitizedTask = sanitizeTaskDescription(taskDescription);
    const prd = await readPRDAsync() || '';
    const root = getWorkspaceRoot();

    return `

===================================================================
                  GENERATE USER STORIES FOR TASK
===================================================================

You are a User Story Generator. Your role is to break down tasks into smaller, implementable user stories.

## TASK TO BREAK DOWN:
${sanitizedTask}

## PROJECT CONTEXT (PRD.md):
\`\`\`markdown
${prd}
\`\`\`

===================================================================
                    REQUIRED OUTPUT FORMAT
===================================================================

Create or update the file \`.pilotflow/userstories.md\` with user stories for this task.

Add a new section with this EXACT format:

\`\`\`markdown
## Task: ${sanitizedTask}

- [ ] User Story 1: As a [user/developer], I want [feature] so that [benefit]
- [ ] User Story 2: As a [user/developer], I want [feature] so that [benefit]
- [ ] User Story 3: Continue with more stories...
\`\`\`

═══════════════════════════════════════════════════════════════
                      ⚠️ IMPORTANT RULES
═══════════════════════════════════════════════════════════════

1. **User Story Format**: Each story MUST use \`- [ ] \` checkbox format
2. **Keep it focused**: Generate exactly ${storyCount} user stories for this task
3. **Logical Order**: Order stories so they can be completed sequentially
4. **Atomic Stories**: Each story should be completable in one agent session
5. **Clear Acceptance**: Each story should have a clear definition of done
6. **Preserve Existing**: If the file already has content for other tasks, preserve it

## EXAMPLE USER STORIES (good):
- [ ] As a developer, I want to set up the database schema so that data can be persisted
- [ ] As a user, I want to see a list of items so that I can browse available options
- [ ] As a user, I want to filter items by category so that I can find what I need faster

## BAD USER STORIES:
- [ ] Create file (too vague - what file? why?)
- [ ] Fix bug (what bug? be specific)
- [ ] 12+ stories (too many - keep it to 5-8!)

═══════════════════════════════════════════════════════════════

Workspace: ${root}

Now create the user stories for this task. Make them specific, actionable, and testable.`;
}

/**
 * Build the agent prompt for implementing a user story
 */
export async function buildUserStoryImplementationPrompt(
    userStoryDescription: string,
    taskDescription: string,
    requirements: TaskRequirements
): Promise<string> {
    const sanitizedStory = sanitizeTaskDescription(userStoryDescription);
    const sanitizedTask = sanitizeTaskDescription(taskDescription);
    const prd = await readPRDAsync() || '';
    const progress = await readProgressAsync();
    const userStories = await readUserStoriesAsync() || '';
    const root = getWorkspaceRoot();

    const parts: string[] = [
        '',
        '===================================================================',
        '                    USER STORY TO IMPLEMENT',
        '===================================================================',
        '',
        sanitizedStory,
        '',
        '───────────────────────────────────────────────────────────────',
        `Parent Task: ${sanitizedTask}`,
        '───────────────────────────────────────────────────────────────',
        '',
        '===================================================================',
        '     MANDATORY: UPDATE userstories.md AND progress.txt WHEN DONE',
        '═══════════════════════════════════════════════════════════════',
        '',
        '🚨 THESE STEPS ARE REQUIRED - DO NOT SKIP THEM! 🚨',
        '',
        '1. After completing this user story, UPDATE .pilotflow/userstories.md:',
        '',
        `   Find this line:    - [ ] ${sanitizedStory}`,
        `   Change it to:      - [x] ${sanitizedStory}`,
        '',
        '2. APPEND to .pilotflow/progress.txt with what you did:',
        '',
        '   Add a new line describing what was completed, e.g.:',
        `   "Completed user story: ${sanitizedStory} - [brief summary]"`,
        '',
        'Both updates are required for PilotFlow to continue to the next user story!',
        '',
        '═══════════════════════════════════════════════════════════════',
        '                      PROJECT CONTEXT',
        '═══════════════════════════════════════════════════════════════',
        '',
        '## Current PRD.md Contents:',
        '',
        '┌─────────────────────────────────────────────────────────────┐',
        prd || '(No PRD content found)',
        '└─────────────────────────────────────────────────────────────┘',
        '',
        '## Current User Stories (.pilotflow/userstories.md):',
        '',
        '┌─────────────────────────────────────────────────────────────┐',
        userStories || '(No user stories content found)',
        '└─────────────────────────────────────────────────────────────┘',
        ''
    ];

    if (progress && progress.trim()) {
        parts.push('## Progress Log (.pilotflow/progress.txt):');
        parts.push('');
        parts.push('┌─────────────────────────────────────────────────────────────┐');
        parts.push(progress);
        parts.push('└─────────────────────────────────────────────────────────────┘');
        parts.push('');
    }

    parts.push('═══════════════════════════════════════════════════════════════');
    parts.push('                       WORKFLOW REMINDER');
    parts.push('═══════════════════════════════════════════════════════════════');
    parts.push('');
    parts.push('⚠️ CRITICAL INSTRUCTIONS:');
    parts.push('');
    parts.push('❌ DO NOT ASK QUESTIONS - Just implement the story completely');
    parts.push('❌ DO NOT wait for confirmation - Finish all tasks autonomously');
    parts.push('❌ DO NOT leave partial implementations - Complete everything');
    parts.push('✅ MAKE DECISIONS based on best practices when details are unclear');
    parts.push('✅ IMPLEMENT FULLY and update tracking files when done');
    parts.push('');
    parts.push('Steps to complete:');
    parts.push('');
    parts.push('1. ✅ Implement this user story');

    let stepNum = 2;
    if (requirements.writeTests) {
        parts.push(`${stepNum}. ✅ Write unit tests for your implementation`);
        stepNum++;
    }
    if (requirements.runTests) {
        parts.push(`${stepNum}. ✅ Run tests and ensure they pass`);
        stepNum++;
    }

    parts.push(`${stepNum}. ✅ UPDATE .pilotflow/userstories.md: Mark this user story as complete [x]`);
    stepNum++;
    parts.push(`${stepNum}. ✅ APPEND to .pilotflow/progress.txt: Record what you completed`);

    parts.push('');
    parts.push(`Workspace: ${root}`);
    parts.push('');
    parts.push('Begin now. Remember: NO QUESTIONS - implement fully and update tracking files!');

    return parts.join('\n');
}
