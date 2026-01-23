# PilotFlow - Autonomous PRD Development

**PilotFlow** runs AI coding agents in a loop. It reads a PRD (Product Requirements Document), picks tasks, implements them one at a time using the GitHub Copilot SDK, and continues until everything is done.

> ⚠️ **EXPERIMENTAL** - This extension uses the `@github/copilot-sdk` which is in Technical Preview. The SDK requires the GitHub Copilot CLI to be installed and authenticated.

## Features

- **Sidebar Control Panel** - Full control from the Activity Bar with real-time status
- **Autonomous Task Execution** - Automatically works through your PRD task list
- **Copilot SDK Integration** - Uses the official Copilot SDK for programmatic agent control
- **Progress Tracking** - Visual status bar and sidebar show progress and current task
- **File Watching** - Automatically detects when Copilot marks tasks complete in PRD.md
- **Inactivity Detection** - Prompts you if Copilot seems stuck
- **PRD Generation** - Describe what you want to build and PilotFlow creates the task list
- **Progress Log** - Maintains a progress.txt file with completed work history

## How It Works

1. **Read PRD.md** - PilotFlow finds and parses your PRD file
2. **Find next unchecked task** - Identifies the next `- [ ]` item
3. **Generate User Stories** - Copilot breaks the task into 3-5 smaller user stories
4. **Save User Stories** - Stories are saved to `.pilotflow/userstories.md`
5. **Implement User Stories** - Each user story is sent to Copilot one at a time
6. **Mark Story Complete** - Copilot marks each story `[x]` when done
7. **Complete Task** - When all user stories for a task are done, the task is marked complete
8. **Countdown & continue** - After a brief countdown, PilotFlow starts the next task
9. **Repeat** - Loop continues until all tasks are done

### User Stories Workflow

PilotFlow uses a two-tier approach for more granular implementation:

- **Tasks** (from PRD.md) are high-level work items
- **User Stories** (in userstories.md) are smaller, actionable pieces of each task

This ensures each Copilot session has a focused, achievable goal while maintaining the big-picture context from the PRD.

## Quick Start

### Generate a PRD from a Description
1. Run **"PilotFlow: Generate PRD from Description"** from the Command Palette
2. Describe what you want to build
3. Copilot creates PRD.md with a structured task list
4. Run **"PilotFlow: Start Loop"** to begin autonomous development

### Use an Existing PRD
1. Create a `.pilotflow/PRD.md` file in your workspace:
   ```markdown
   # My Project

   ## Tasks
   - [ ] Set up project structure with dependencies
   - [ ] Create core data models and types
   - [ ] Implement main application logic
   - [ ] Add user interface and styling
   - [ ] Write tests and documentation
   ```
2. Run **"PilotFlow: Start Loop"** from the Command Palette

## Task Format

PilotFlow recognizes these checkbox formats:
- `- [ ]` - Pending task (will be executed)
- `- [x]` - Completed task (skipped)
- `- [~]` - In progress task (will be executed)
- `- [!]` - Blocked task (skipped)

## Commands

| Command | Description |
|---------|-------------|
| `PilotFlow: Open Control Panel` | Show status and quick actions |
| `PilotFlow: Start Loop` | Start processing tasks from the PRD |
| `PilotFlow: Stop Loop` | Stop the current execution |
| `PilotFlow: Pause Loop` | Pause execution (can resume) |
| `PilotFlow: Resume Loop` | Resume paused execution |
| `PilotFlow: Run Single Step` | Execute just the next task |
| `PilotFlow: Generate PRD from Description` | Create PRD.md from a description |
| `PilotFlow: View Logs` | Open the PilotFlow output channel |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `pilotflow.files.prdPath` | `.pilotflow/PRD.md` | Path to the PRD file |
| `pilotflow.files.progressPath` | `.pilotflow/progress.txt` | Path to the progress log file |
| `pilotflow.files.userStoriesPath` | `.pilotflow/userstories.md` | Path to user stories file |
| `pilotflow.prompt.customTemplate` | (empty) | Custom prompt template for tasks |
| `pilotflow.prompt.customPrdGenerationTemplate` | (empty) | Custom PRD generation template |

### Custom Prompt Templates

You can customize the prompts sent to Copilot using these placeholders:
- `{{task}}` - The current task description
- `{{prd}}` - Full PRD.md contents
- `{{progress}}` - Progress log contents
- `{{requirements}}` - Requirement steps
- `{{workspace}}` - Workspace path

## Status Bar

PilotFlow adds a status bar item showing:
- **$(rocket) PilotFlow** - Idle, click to open control panel
- **$(sync~spin) PilotFlow: Running #N** - Processing task N
- **$(watch) PilotFlow: Waiting** - Waiting for Copilot to complete
- **$(debug-pause) PilotFlow: Paused** - Loop paused

## Sidebar

Click the **🚀 PilotFlow** icon in the Activity Bar to open the sidebar control panel:

- **Progress Stats** - See completed/pending tasks and current iteration
- **Countdown Timer** - Visual countdown before next task starts
- **Current Task** - Shows what's being worked on
- **Control Buttons** - Start, Stop, Pause, Resume, Single Step, Generate PRD
- **User Stories** - See user stories for each task with completion progress
- **Task List** - View all tasks with their status (pending/complete/blocked)
- **Activity Log** - Real-time log of PilotFlow operations

## File Structure

PilotFlow maintains these files in the `.pilotflow/` folder:

```
.pilotflow/
├── PRD.md           # Product Requirements Document with tasks
├── progress.txt     # Log of completed work
└── userstories.md   # Generated user stories for each task
```

### User Stories Format

User stories are organized by task in `userstories.md`:

```markdown
## Task: Set up project structure with dependencies

- [x] Initialize npm project with package.json
- [x] Add TypeScript configuration
- [ ] Set up ESLint and Prettier
- [ ] Configure build scripts

## Task: Create core data models and types

- [ ] Define User interface with required fields
- [ ] Create validation schemas
```

## Requirements

- VS Code 1.93 or later
- GitHub Copilot CLI installed and authenticated
  - Follow the [installation guide](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli)
  - Verify by running `copilot --version` in a terminal
- Node.js 18.0 or later
- A valid GitHub Copilot subscription

## Architecture

```
src/
├── extension.ts        # Main entry point
├── orchestrator.ts     # Main loop orchestration
├── taskRunner.ts       # Task execution logic
├── copilotSdk.ts       # Copilot SDK integration
├── sidebarProvider.ts  # Sidebar webview provider
├── fileUtils.ts        # PRD parsing and file operations
├── fileWatchers.ts     # File change detection
├── timerManager.ts     # Countdown and inactivity timers
├── promptBuilder.ts    # Prompt construction
├── statusBar.ts        # Status bar UI
├── uiManager.ts        # UI coordination
├── config.ts           # Configuration handling
├── logger.ts           # Logging utilities
└── types.ts            # TypeScript interfaces
```

## Tips

- Write clear, actionable task descriptions
- Keep tasks to 5-6 per PRD (each runs as a separate agent request)
- Start each task with a verb (Create, Add, Implement, Configure, etc.)
- The prompt instructs Copilot to update PRD.md when done - this triggers the next task

## License

MIT
